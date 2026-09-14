#!/usr/bin/env node
/**
 * LuckRead API Endpoint Registry Closure.
 *
 * Source-of-truth layers:
 *   L0 contracts/api/api-inventory.v1.json (capability blueprint)
 *   L2 contracts/api/*-operation-policy.v1.json (domain operations)
 *   L3 contracts/openapi/v1/openapi.yaml (canonical HTTP surface)
 *
 * This checker derives a three-way endpoint registry. It never promotes a
 * missing mapping to PASS and never mutates contracts. Inventory paths use
 * /v1 while canonical OpenAPI uses /api/v1 as its server prefix, so path
 * comparison is normalized before comparison.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const findings = [];
const inventoryEndpoints = [];
const domainOperations = new Map();
const openapiEndpoints = new Map();

const inventoryFile = path.join(root, 'contracts', 'api', 'api-inventory.v1.json');
const domainDir = path.join(root, 'contracts', 'api');
const openapiFile = path.join(root, 'contracts', 'openapi', 'v1', 'openapi.yaml');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    failures.push({ code: 'INVALID_JSON', source: path.relative(root, file), message: error.message });
    return null;
  }
}

function normalizePath(value, source) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  let p = value.replace(/\/+$/, '') || '/';
  if (source === 'inventory' && p.startsWith('/v1/')) p = `/api${p}`;
  if (source === 'domain' && p.startsWith('/')) p = `/api/v1${p}`;
  if (source === 'openapi' && !p.startsWith('/api/v1')) p = `/api/v1${p}`;
  return p.replace(/\{([^}]+)\}/g, '{$1}');
}

function endpointKey(method, normalizedPath) {
  return `${String(method).toUpperCase()} ${normalizedPath}`;
}

function addDomainOperation(op, source) {
  if (!op?.operationId || !op?.method || !op?.path) return;
  const key = endpointKey(op.method, normalizePath(op.path, 'domain'));
  if (domainOperations.has(op.operationId)) {
    failures.push({ code: 'DUPLICATE_DOMAIN_OPERATION_ID', operationId: op.operationId, source });
  }
  if (domainOperations.has(`endpoint:${key}`)) {
    failures.push({ code: 'DUPLICATE_DOMAIN_ENDPOINT', endpoint: key, source });
  }
  domainOperations.set(op.operationId, { ...op, source, normalizedPath: normalizePath(op.path, 'domain'), endpointKey: key });
  domainOperations.set(`endpoint:${key}`, { ...op, source, normalizedPath: normalizePath(op.path, 'domain'), endpointKey: key });
}

if (!fs.existsSync(inventoryFile)) {
  failures.push({ code: 'MISSING_ENDPOINT_BLUEPRINT', source: 'contracts/api/api-inventory.v1.json' });
} else {
  const inventory = readJson(inventoryFile);
  if (inventory?.domains) {
    for (const [domain, definition] of Object.entries(inventory.domains)) {
      for (const raw of definition?.endpoint_groups ?? []) {
        const match = String(raw).match(/^(GET|POST|PATCH|PUT|DELETE)\s+(\/.*)$/i);
        if (!match) {
          findings.push({ code: 'INVALID_INVENTORY_ENDPOINT', domain, endpoint: raw });
          continue;
        }
        const method = match[1].toUpperCase();
        const pathValue = match[2];
        inventoryEndpoints.push({ domain, method, path: pathValue, normalizedPath: normalizePath(pathValue, 'inventory'), endpointKey: endpointKey(method, normalizePath(pathValue, 'inventory')) });
      }
    }
  } else {
    failures.push({ code: 'MISSING_INVENTORY_DOMAINS' });
  }
}

if (!fs.existsSync(domainDir)) failures.push({ code: 'MISSING_DOMAIN_CONTRACT_DIRECTORY' });
else {
  for (const file of fs.readdirSync(domainDir).filter((f) => f.endsWith('-operation-policy.v1.json')).sort()) {
    const doc = readJson(path.join(domainDir, file));
    for (const op of doc?.operations ?? []) addDomainOperation(op, file);
  }
}

if (!fs.existsSync(openapiFile)) {
  failures.push({ code: 'MISSING_CANONICAL_OPENAPI' });
} else {
  let currentPath = null;
  let currentMethod = null;
  let currentOperationId = null;
  for (const line of fs.readFileSync(openapiFile, 'utf8').split(/\r?\n/)) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) { currentPath = pathMatch[1]; currentMethod = null; currentOperationId = null; continue; }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/i);
    if (methodMatch && currentPath) { currentMethod = methodMatch[1].toUpperCase(); currentOperationId = null; continue; }
    const operationMatch = line.match(/^      operationId:\s*([A-Za-z][A-Za-z0-9]+)\s*$/);
    if (operationMatch && currentPath && currentMethod) {
      currentOperationId = operationMatch[1];
      const normalizedPath = normalizePath(currentPath, 'openapi');
      const key = endpointKey(currentMethod, normalizedPath);
      if (openapiEndpoints.has(key)) failures.push({ code: 'DUPLICATE_OPENAPI_ENDPOINT', endpoint: key });
      openapiEndpoints.set(key, { method: currentMethod, path: currentPath, normalizedPath, operationId: currentOperationId, endpointKey: key });
    }
  }
}

const byInventory = new Map(inventoryEndpoints.map((x) => [x.endpointKey, x]));
const domainByEndpoint = new Map();
for (const op of domainOperations.values()) if (!op.operationId) domainByEndpoint.set(op.endpointKey, op);
const domainOps = [...domainOperations.values()].filter((x) => x.operationId);
for (const op of domainOps) domainByEndpoint.set(op.endpointKey, op);

for (const item of inventoryEndpoints) {
  const domain = domainByEndpoint.get(item.endpointKey);
  const openapi = openapiEndpoints.get(item.endpointKey);
  if (!domain && !openapi) findings.push({ code: 'INVENTORY_ONLY', endpoint: item.endpointKey, domain: item.domain });
  else if (!domain) findings.push({ code: 'INVENTORY_OPENAPI_ONLY', endpoint: item.endpointKey, domain: item.domain, operationId: openapi.operationId });
  else if (!openapi) findings.push({ code: 'INVENTORY_DOMAIN_ONLY', endpoint: item.endpointKey, domain: item.domain, operationId: domain.operationId });
  else if (openapi.operationId !== domain.operationId) findings.push({ code: 'OPERATION_ID_CONFLICT', endpoint: item.endpointKey, domainOperationId: domain.operationId, openapiOperationId: openapi.operationId });
  else findings.push({ code: 'MATCH', endpoint: item.endpointKey, domain: item.domain, operationId: domain.operationId });
}

for (const [key, op] of domainByEndpoint) {
  if (!byInventory.has(key)) findings.push({ code: 'DOMAIN_ONLY', endpoint: key, operationId: op.operationId, source: op.source });
}
for (const [key, op] of openapiEndpoints) {
  if (!byInventory.has(key)) findings.push({ code: 'OPENAPI_ONLY', endpoint: key, operationId: op.operationId });
}

const duplicateOperationIds = new Map();
for (const op of domainOps) {
  const list = duplicateOperationIds.get(op.operationId) ?? [];
  list.push(op.endpointKey);
  duplicateOperationIds.set(op.operationId, list);
}
for (const [operationId, endpoints] of duplicateOperationIds) if (new Set(endpoints).size > 1) findings.push({ code: 'OPERATION_ID_MULTIPLE_ENDPOINTS', operationId, endpoints });

const summary = findings.reduce((acc, item) => { acc[item.code] = (acc[item.code] ?? 0) + 1; return acc; }, {});
const structuralCodes = new Set(['INVALID_JSON','MISSING_ENDPOINT_BLUEPRINT','MISSING_INVENTORY_DOMAINS','MISSING_DOMAIN_CONTRACT_DIRECTORY','MISSING_CANONICAL_OPENAPI','DUPLICATE_DOMAIN_OPERATION_ID','DUPLICATE_DOMAIN_ENDPOINT','DUPLICATE_OPENAPI_ENDPOINT','OPERATION_ID_MULTIPLE_ENDPOINTS','OPERATION_ID_CONFLICT']);
const unresolvedCodes = new Set(['INVENTORY_ONLY','INVENTORY_DOMAIN_ONLY','INVENTORY_OPENAPI_ONLY','DOMAIN_ONLY','OPENAPI_ONLY','INVALID_INVENTORY_ENDPOINT']);
const structural = failures.length > 0 || findings.some((x) => structuralCodes.has(x.code));
const unresolved = findings.some((x) => unresolvedCodes.has(x.code));
const status = structural ? 'CONFLICT' : unresolved ? 'INCOMPLETE' : 'PASS';

const report = {
  schemaVersion: '1.0.0',
  status,
  reconciliationGreen: status === 'PASS',
  inventoryEndpointCount: inventoryEndpoints.length,
  domainOperationCount: domainOps.length,
  canonicalOpenapiEndpointCount: openapiEndpoints.size,
  matchCount: summary.MATCH ?? 0,
  findingCount: findings.length,
  summary,
  failures,
  findings,
  normalization: {
    inventoryPrefix: '/v1',
    domainPrefix: '/',
    canonicalServerPrefix: '/api/v1',
    normalizedPrefix: '/api/v1',
    rule: 'Inventory /v1/* and domain /* are normalized to canonical /api/v1/* before comparison.'
  },
  rule: 'PASS requires zero structural conflicts and zero unresolved three-way endpoint mappings. This report is derived evidence and is not a source of truth.'
};

const evidenceDir = path.join(root, 'artifacts', 'api-inventory');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'endpoint-registry-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(status === 'PASS' ? 0 : 1);
