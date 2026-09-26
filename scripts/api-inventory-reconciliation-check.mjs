#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inventoryBaseline = path.join(root, 'contracts', 'api', 'api-inventory.v1.json');
const inventoryDir = path.join(root, 'contracts', 'api');
const openapiPolicy = path.join(root, 'contracts', 'openapi', 'v1', 'operation-policy.json');
const openapiSpec = path.join(root, 'contracts', 'openapi', 'v1', 'openapi.yaml');
const failures = [];
const findings = [];
const matches = [];
const inventory = new Map();
const policyInventory = new Map();
const alternateOperationDefinitions = new Map();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    failures.push({ code: 'INVALID_JSON', source: path.relative(root, file), message: error.message });
    return null;
  }
}

function finding(code, operationId, detail) {
  findings.push({ code, operationId: operationId ?? null, detail });
}

function canonicalApiPath(value) {
  const raw = String(value ?? '').trim();
  if (raw.startsWith('/v1/')) return raw.slice(3);
  return raw;
}

function effectiveDetailedPolicyStatus(op) {
  return op?.status ?? op?.contractStatus ?? 'UNSPECIFIED';
}

function isDiscoveryDraftCanonicalPolicy(op) {
  return op?.['x-luckread-contract-status'] === 'DISCOVERY_DRAFT';
}

function collectAlternateOperationSources(directory) {
  const sources = new Map();

  for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.json') && !f.endsWith('-operation-policy.v1.json')).sort()) {
    const source = path.join(directory, file);
    const doc = readJson(source);
    if (!doc) continue;

    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (typeof value.operationId === 'string') {
        const sourcePath = path.relative(root, source);
        const list = new Set(sources.get(value.operationId) ?? []);
        list.add(sourcePath);
        sources.set(value.operationId, [...list].sort());
        if (typeof value.method === 'string' && typeof value.path === 'string') {
          const defs = alternateOperationDefinitions.get(value.operationId) ?? [];
          defs.push({ source: sourcePath, method: value.method.toUpperCase(), path: value.path });
          alternateOperationDefinitions.set(value.operationId, defs);
        }
      }
      for (const nested of Object.values(value)) visit(nested);
    };

    visit(doc);
  }

  return sources;
}

function addPolicyOperation(op, source) {
  if (!op?.operationId) {
    failures.push({ code: 'MISSING_OPERATION_ID', source });
    return;
  }
  const id = op.operationId;
  if (policyInventory.has(id)) {
    failures.push({ code: 'DUPLICATE_OPERATION_ID', operationId: id, source });
  }
  policyInventory.set(id, { ...op, __source: source });
  if (!op.method || !op.path) {
    failures.push({ code: 'MISSING_METHOD_OR_PATH', operationId: id, source });
  }
  for (const field of ['authorization','resource','cache','retry','event','queue','antiAbuse','idempotency','security','evidence']) {
    if (!op[field]) finding('MISSING_POLICY', id, field);
  }
}

function parseOpenApiOperations(file) {
  const operations = new Map();
  const byMethodPath = new Map();
  if (!fs.existsSync(file)) {
    failures.push({ code: 'MISSING_OPENAPI_SPEC', source: path.relative(root, file) });
    return { operations, byMethodPath };
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let currentPath = null;
  let currentMethod = null;
  let currentOperationId = null;

  const flush = () => {
    if (!currentOperationId) return;
    const operation = {
      operationId: currentOperationId,
      method: String(currentMethod ?? '').toUpperCase(),
      path: currentPath,
    };
    if (operations.has(currentOperationId)) {
      failures.push({ code: 'OPENAPI_DUPLICATE_OPERATION_ID', operationId: currentOperationId });
    } else {
      operations.set(currentOperationId, operation);
    }
    const key = \`\${operation.method} \${operation.path}\`;
    if (byMethodPath.has(key)) {
      failures.push({ code: 'DUPLICATE_METHOD_PATH', operationId: currentOperationId, source: 'openapi' });
    } else {
      byMethodPath.set(key, operation);
    }
    currentOperationId = null;
  };

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:#]+):\s*$/);
    if (pathMatch) {
      flush();
      currentPath = pathMatch[1].trim();
      currentMethod = null;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete|head|options|trace):\s*$/i);
    if (methodMatch && currentPath) {
      flush();
      currentMethod = methodMatch[1].toLowerCase();
      continue;
    }
    if (currentPath && currentMethod) {
      const operationMatch = line.match(/^\s+operationId:\s*([^#\s]+)\s*(?:#.*)?$/);
      if (operationMatch) currentOperationId = operationMatch[1].trim();
    }
  }
  flush();
  return { operations, byMethodPath };
}

function parseCanonicalInventory(file, openapiByMethodPath) {
  const baseline = readJson(file);
  const records = new Map();
  if (!baseline) return records;
  if (!baseline.domains || typeof baseline.domains !== 'object') {
    failures.push({ code: 'MISSING_INVENTORY_DOMAINS', source: path.relative(root, file) });
    return records;
  }

  for (const [domain, group] of Object.entries(baseline.domains)) {
    if (!Array.isArray(group?.endpoint_groups)) {
      failures.push({ code: 'MISSING_OPERATIONS_ARRAY', source: \`\${path.relative(root, file)}#\${domain}\` });
      continue;
    }
    for (const raw of group.endpoint_groups) {
      const match = String(raw).match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/v1\/\S+)$/);
      if (!match) {
        failures.push({ code: 'INVALID_INVENTORY_ENDPOINT', source: String(raw) });
        continue;
      }
      const [, method, versionedPath] = match;
      const key = \`\${method} \${versionedPath}\`;
      if (records.has(key)) {
        failures.push({ code: 'DUPLICATE_METHOD_PATH', operationId: null, source: \`\${path.relative(root, file)}#\${key}\` });
        continue;
      }

      const openapi = openapiByMethodPath.get(\`\${method} \${canonicalApiPath(versionedPath)}\`);
      if (!openapi) {
        records.set(key, {
          operationId: null,
          method,
          path: versionedPath,
          domain,
          __source: 'contracts/api/api-inventory.v1.json',
        });
        continue;
      }

      const record = {
        operationId: openapi.operationId,
        method,
        path: versionedPath,
        domain,
        __source: 'contracts/api/api-inventory.v1.json',
      };
      if (inventory.has(record.operationId)) {
        failures.push({ code: 'DUPLICATE_OPERATION_ID', operationId: record.operationId, source: path.relative(root, file) });
      }
      records.set(key, record);
      inventory.set(record.operationId, record);
    }
  }

  for (const record of records.values()) {
    if (!record.operationId) {
      finding('UNRECONCILED_INVENTORY_OPERATION', null, \`inventory endpoint is not represented in canonical OpenAPI paths: \${record.method} \${record.path}\`);
    }
  }

  return records;
}

const { operations: openapiOps, byMethodPath: openapiByMethodPath } = parseOpenApiOperations(openapiSpec);
const canonicalInventoryRecords = parseCanonicalInventory(inventoryBaseline, openapiByMethodPath);
const alternateOperationSources = collectAlternateOperationSources(inventoryDir);
const detailedPolicyDomains = new Set([
  'auth_identity',
  'users_accounts',
  'content',
  'media',
  'feed',
  'interaction',
]);

if (!fs.existsSync(inventoryDir)) {
  failures.push({ code: 'MISSING_API_INVENTORY_DIRECTORY' });
} else {
  for (const file of fs.readdirSync(inventoryDir).filter((f) => f.endsWith('-operation-policy.v1.json')).sort()) {
    const doc = readJson(path.join(inventoryDir, file));
    if (!doc) continue;
    if (!doc.domain) finding('MISSING_DOMAIN', null, file);
    if (!Array.isArray(doc.operations)) finding('MISSING_OPERATIONS_ARRAY', null, file);
    else doc.operations.forEach((op) => addPolicyOperation(op, file));
  }
}

const policy = fs.existsSync(openapiPolicy) ? readJson(openapiPolicy) : null;
const policyOps = new Map();
if (!policy) {
  failures.push({ code: 'MISSING_OPENAPI_OPERATION_POLICY' });
} else if (!Array.isArray(policy.operations)) {
  failures.push({ code: 'OPENAPI_POLICY_MISSING_OPERATIONS_ARRAY' });
} else {
  for (const op of policy.operations) {
    if (!op?.operationId) {
      failures.push({ code: 'OPENAPI_POLICY_MISSING_OPERATION_ID' });
    } else if (policyOps.has(op.operationId)) {
      failures.push({ code: 'OPENAPI_DUPLICATE_OPERATION_ID', operationId: op.operationId });
    } else {
      policyOps.set(op.operationId, op);
    }
  }
}

for (const [, record] of canonicalInventoryRecords) {
  if (!record.operationId) continue;
  const openapi = openapiOps.get(record.operationId);
  if (!openapi) {
    finding('UNRECONCILED_INVENTORY_OPERATION', record.operationId, 'operationId is not represented in canonical OpenAPI paths');
    continue;
  }
  const inventoryMethod = String(record.method).toUpperCase();
  const openapiMethod = String(openapi.method).toUpperCase();
  if (inventoryMethod !== openapiMethod) {
    finding('METHOD_CONFLICT', record.operationId, \`inventory=\${inventoryMethod} openapi=\${openapiMethod}\`);
  } else if (canonicalApiPath(record.path) !== openapi.path) {
    finding('PATH_CONFLICT', record.operationId, \`inventory=\${record.path} openapi=\${openapi.path}\`);
  } else {
    matches.push({
      operationId: record.operationId,
      inventory: { method: inventoryMethod, path: record.path, domain: record.domain },
      openapi,
    });
  }
}

for (const [id] of openapiOps) {
  if (!inventory.has(id)) {
    finding('UNRECONCILED_OPENAPI_OPERATION', id, 'canonical OpenAPI operation is not represented in public API inventory');
  }
}

for (const [id, op] of policyInventory) {
  if (effectiveDetailedPolicyStatus(op) === 'MISSING') continue;

  const openapi = openapiOps.get(id);
  if (!openapi) {
    finding('UNRECONCILED_POLICY_OPERATION', id, 'active detailed domain policy operation is not represented in canonical OpenAPI');
    continue;
  }
  if (String(op.method).toUpperCase() !== String(openapi.method).toUpperCase()) {
    finding('METHOD_CONFLICT', id, `policy=${String(op.method).toUpperCase()} openapi=${String(openapi.method).toUpperCase()}`);
  } else if (canonicalApiPath(op.path) !== openapi.path) {
    finding('PATH_CONFLICT', id, `policy=${op.path} openapi=${openapi.path}`);
  }
}

function hasNormalizedAlternatePolicySource(id, record, canonicalPolicy) {
  const source = canonicalPolicy?.['x-luckread-source'];
  if (!source) return false;
  const candidates = alternateOperationDefinitions.get(id) ?? [];
  const selected = candidates.filter((candidate) => candidate.source === source);
  if (selected.length !== 1) return false;
  const candidate = selected[0];
  return candidate.method === String(record.method).toUpperCase() &&
    canonicalApiPath(candidate.path) === canonicalApiPath(record.path);
}

for (const [id] of inventory) {
  const canonicalPolicy = policyOps.get(id);
  if (isDiscoveryDraftCanonicalPolicy(canonicalPolicy)) continue;

  const record = inventory.get(id);
  if (!record || !detailedPolicyDomains.has(record.domain)) continue;

  const detailedPolicy = policyInventory.get(id);
  if (!detailedPolicy || effectiveDetailedPolicyStatus(detailedPolicy) === 'MISSING') {
    const alternateSources = alternateOperationSources.get(id) ?? [];
    if (hasNormalizedAlternatePolicySource(id, record, canonicalPolicy)) {
      continue;
    }
    if (canonicalPolicy?.['x-luckread-source'] && alternateSources.length > 0) {
      finding(
        'POLICY_SOURCE_NORMALIZATION_CONFLICT',
        id,
        `declared source-of-authority does not uniquely match canonical method/path: ${canonicalPolicy['x-luckread-source']}`,
      );
    } else if (alternateSources.length > 0) {
      finding(
        'POLICY_SOURCE_PRESENT_NOT_NORMALIZED',
        id,
        `authoritative operation contract exists outside detailed domain operation policy: ${alternateSources.join(', ')}`,
      );
    } else {
      finding('MISSING_POLICY_OPERATION', id, 'non-discovery canonical operation in a core reconciliation domain has no active detailed domain operation policy or alternate operation contract');
    }
  }
}

for (const [id] of openapiOps) {
  if (!policyOps.has(id)) finding('UNRECONCILED_OPENAPI_POLICY_OPERATION', id, 'canonical OpenAPI operationId is missing from operation-policy registry');
}
for (const [id] of policyOps) {
  if (!openapiOps.has(id)) finding('UNRECONCILED_POLICY_OPERATION', id, 'operation-policy operationId is not represented in canonical OpenAPI');
}

const criticalEvidence = ['openapi','permission','state','resource','cache','antiAbuse','integration','securityE2E'];
const allowedEvidence = new Set(['PASS', 'N/A']);
for (const [id, op] of policyInventory) {
  if (effectiveDetailedPolicyStatus(op) === 'MISSING') continue;

  if (!op.evidence) {
    finding('EVIDENCE_MISSING', id, 'evidence object absent');
    continue;
  }
  for (const field of criticalEvidence) {
    const value = op.evidence[field];
    if (value === undefined || value === null || value === 'MISSING') {
      finding('EVIDENCE_INCOMPLETE', id, field);
    } else if (!allowedEvidence.has(value)) {
      finding('EVIDENCE_INVALID', id, \`\${field}=\${String(value)}\`);
    }
  }
}

const conflictCodes = new Set([
  'INVALID_JSON',
  'DUPLICATE_OPERATION_ID',
  'DUPLICATE_METHOD_PATH',
  'OPENAPI_POLICY_MISSING_OPERATION_ID',
  'OPENAPI_DUPLICATE_OPERATION_ID',
  'MISSING_OPERATION_ID',
  'MISSING_METHOD_OR_PATH',
  'METHOD_CONFLICT',
  'PATH_CONFLICT',
  'POLICY_SOURCE_NORMALIZATION_CONFLICT',
]);
const incompleteCodes = new Set([
  'MISSING_API_INVENTORY_DIRECTORY',
  'MISSING_INVENTORY_DOMAINS',
  'MISSING_OPENAPI_SPEC',
  'MISSING_OPENAPI_OPERATION_POLICY',
  'OPENAPI_POLICY_MISSING_OPERATIONS_ARRAY',
  'MISSING_POLICY',
  'MISSING_POLICY_OPERATION',
  'POLICY_SOURCE_PRESENT_NOT_NORMALIZED',
  'MISSING_DOMAIN',
  'MISSING_OPERATIONS_ARRAY',
  'INVALID_INVENTORY_ENDPOINT',
  'EVIDENCE_MISSING',
  'EVIDENCE_INCOMPLETE',
  'EVIDENCE_INVALID',
  'UNRECONCILED_INVENTORY_OPERATION',
  'UNRECONCILED_OPENAPI_OPERATION',
  'UNRECONCILED_POLICY_OPERATION',
  'UNRECONCILED_OPENAPI_POLICY_OPERATION',
]);

const hasConflict =
  failures.some((x) => conflictCodes.has(x.code)) ||
  findings.some((x) => conflictCodes.has(x.code));
const hasIncomplete =
  failures.some((x) => incompleteCodes.has(x.code)) ||
  findings.some((x) => incompleteCodes.has(x.code));

const status = hasConflict ? 'CONFLICT' : hasIncomplete ? 'INCOMPLETE' : 'PASS';
const report = {
  schemaVersion: '1.2.0',
  generatedAt: new Date().toISOString(),
  status,
  reconciliationGreen: status === 'PASS',
  inventoryCount: inventory.size,
  openapiOperationCount: openapiOps.size,
  openapiPolicyCount: policyOps.size,
  failureCount: failures.length,
  findingCount: findings.length,
  policyGapSummary: {
    coreDetailedPolicyDomainCount: detailedPolicyDomains.size,
    alternatePolicyNormalizationGapCount: findings.filter((x) => x.code === 'POLICY_SOURCE_PRESENT_NOT_NORMALIZED').length,
    normalizedPolicySourceCount: [...policyOps.entries()].filter(([id, op]) => {
      const record = inventory.get(id);
      return record && hasNormalizedAlternatePolicySource(id, record, op);
    }).length,
    coreDetailedPolicyMissingCount: findings.filter((x) => x.code === 'MISSING_POLICY_OPERATION').length,
  },
  failures,
  findings,
  matches,
  alternatePolicySources: [...alternateOperationSources.entries()]
    .map(([operationId, sources]) => ({ operationId, sources }))
    .sort((a, b) => a.operationId.localeCompare(b.operationId)),
  evidenceSemantics: { pass: ['PASS','N/A'], incomplete: ['MISSING','ABSENT'], invalid: ['unknown_or_unsupported'] },
  rule: 'PASS requires zero structural conflicts, zero unresolved required inventory/OpenAPI/policy membership, zero missing required detailed policy coverage, zero alternate-policy normalization gaps, and zero incomplete/invalid evidence. alternatePolicySources is informational authority-trace evidence only; it does not promote an operation to Green. Explicit DISCOVERY_DRAFT and MISSING operation-policy statuses remain pending and do not silently become contract evidence. N/A is valid only when explicitly declared by the operation contract.',
};
const evidenceDir = path.join(root, 'artifacts', 'api-inventory');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'reconciliation-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(status === 'PASS' ? 0 : 1);
