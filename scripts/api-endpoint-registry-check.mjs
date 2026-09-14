#!/usr/bin/env node
/**
 * LuckRead API Endpoint Registry Closure.
 * Derives L0 inventory ↔ L2 domain operations ↔ L3 canonical OpenAPI.
 * This is evidence only; it never changes contract truth or promotes missing mappings.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const findings = [];
const inventoryEndpoints = [];
const domainOperations = [];
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
  if (source === 'domain') p = `/api/v1${p}`;
  if (source === 'openapi' && !p.startsWith('/api/v1')) p = `/api/v1${p}`;
  return p;
}
function endpointKey(method, normalizedPath) {
  return normalizedPath ? `${String(method).toUpperCase()} ${normalizedPath}` : null;
}

if (!fs.existsSync(inventoryFile)) failures.push({ code: 'MISSING_ENDPOINT_BLUEPRINT' });
else {
  const inventory = readJson(inventoryFile);
  if (!inventory?.domains) failures.push({ code: 'MISSING_INVENTORY_DOMAINS' });
  else for (const [domain, definition] of Object.entries(inventory.domains)) {
    for (const raw of definition?.endpoint_groups ?? []) {
      const match = String(raw).match(/^(GET|POST|PATCH|PUT|DELETE)\s+(\/.*)$/i);
      if (!match) { findings.push({ code: 'INVALID_INVENTORY_ENDPOINT', domain, endpoint: raw }); continue; }
      const method = match[1].toUpperCase();
      const pathValue = match[2];
      const normalizedPath = normalizePath(pathValue, 'inventory');
      inventoryEndpoints.push({ domain, method, path: pathValue, normalizedPath, endpointKey: endpointKey(method, normalizedPath) });
    }
  }
}

if (!fs.existsSync(domainDir)) failures.push({ code: 'MISSING_DOMAIN_CONTRACT_DIRECTORY' });
else for (const file of fs.readdirSync(domainDir).filter((f) => f.endsWith('-operation-policy.v1.json')).sort()) {
  const doc = readJson(path.join(domainDir, file));
  for (const op of doc?.operations ?? []) {
    if (!op?.operationId || !op?.method || !op?.path) continue;
    const normalizedPath = normalizePath(op.path, 'domain');
    domainOperations.push({ ...op, source: file, normalizedPath, endpointKey: endpointKey(op.method, normalizedPath) });
  }
}

const domainByEndpoint = new Map();
const domainByOperationId = new Map();
for (const op of domainOperations) {
  if (domainByEndpoint.has(op.endpointKey)) failures.push({ code: 'DUPLICATE_DOMAIN_ENDPOINT', endpoint: op.endpointKey, source: op.source });
  domainByEndpoint.set(op.endpointKey, op);
  const existing = domainByOperationId.get(op.operationId) ?? [];
  existing.push(op.endpointKey);
  domainByOperationId.set(op.operationId, existing);
}
for (const [operationId, endpoints] of domainByOperationId) {
  if (new Set(endpoints).size > 1) failures.push({ code: 'OPERATION_ID_MULTIPLE_ENDPOINTS', operationId, endpoints });
}

if (!fs.existsSync(openapiFile)) failures.push({ code: 'MISSING_CANONICAL_OPENAPI' });
else {
  let currentPath = null;
  let currentMethod = null;
  for (const line of fs.readFileSync(openapiFile, 'utf8').split(/\r?\n/)) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) { currentPath = pathMatch[1]; currentMethod = null; continue; }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/i);
    if (methodMatch && currentPath) { currentMethod = methodMatch[1].toUpperCase(); continue; }
    const operationMatch = line.match(/^      operationId:\s*([A-Za-z][A-Za-z0-9]+)\s*$/);
    if (operationMatch && currentPath && currentMethod) {
      const normalizedPath = normalizePath(currentPath, 'openapi');
      const key = endpointKey(currentMethod, normalizedPath);
      if (openapiEndpoints.has(key)) failures.push({ code: 'DUPLICATE_OPENAPI_ENDPOINT', endpoint: key });
      openapiEndpoints.set(key, { method: currentMethod, path: currentPath, normalizedPath, operationId: operationMatch[1], endpointKey: key });
    }
  }
}

const inventoryByEndpoint = new Map();
for (const item of inventoryEndpoints) {
  if (inventoryByEndpoint.has(item.endpointKey)) failures.push({ code: 'DUPLICATE_INVENTORY_ENDPOINT', endpoint: item.endpointKey });
  inventoryByEndpoint.set(item.endpointKey, item);
}

for (const item of inventoryEndpoints) {
  const domain = domainByEndpoint.get(item.endpointKey);
  const openapi = openapiEndpoints.get(item.endpointKey);
  if (!domain && !openapi) findings.push({ code: 'INVENTORY_ONLY', endpoint: item.endpointKey, domain: item.domain });
  else if (!domain) findings.push({ code: 'INVENTORY_OPENAPI_ONLY', endpoint: item.endpointKey, domain: item.domain, operationId: openapi.operationId });
  else if (!openapi) findings.push({ code: 'INVENTORY_DOMAIN_ONLY', endpoint: item.endpointKey, domain: item.domain, operationId: domain.operationId });
  else if (openapi.operationId !== domain.operationId) findings.push({ code: 'OPERATION_ID_CONFLICT', endpoint: item.endpointKey, domainOperationId: domain.operationId, openapiOperationId: openapi.operationId });
  else findings.push({ code: 'MATCH', endpoint: item.endpointKey, domain: item.domain, operationId: domain.operationId });
}
for (const op of domainOperations) if (!inventoryByEndpoint.has(op.endpointKey)) findings.push({ code: 'DOMAIN_ONLY', endpoint: op.endpointKey, operationId: op.operationId, source: op.source });
for (const op of openapiEndpoints.values()) if (!inventoryByEndpoint.has(op.endpointKey)) findings.push({ code: 'OPENAPI_ONLY', endpoint: op.endpointKey, operationId: op.operationId });

const summary = findings.reduce((acc, item) => { acc[item.code] = (acc[item.code] ?? 0) + 1; return acc; }, {});
const structuralCodes = new Set(['INVALID_JSON','MISSING_ENDPOINT_BLUEPRINT','MISSING_INVENTORY_DOMAINS','MISSING_DOMAIN_CONTRACT_DIRECTORY','MISSING_CANONICAL_OPENAPI','DUPLICATE_DOMAIN_ENDPOINT','DUPLICATE_INVENTORY_ENDPOINT','DUPLICATE_OPENAPI_ENDPOINT','OPERATION_ID_MULTIPLE_ENDPOINTS','OPERATION_ID_CONFLICT']);
const unresolvedCodes = new Set(['INVENTORY_ONLY','INVENTORY_DOMAIN_ONLY','INVENTORY_OPENAPI_ONLY','DOMAIN_ONLY','OPENAPI_ONLY','INVALID_INVENTORY_ENDPOINT']);
const structural = failures.length > 0 || findings.some((x) => structuralCodes.has(x.code));
const unresolved = findings.some((x) => unresolvedCodes.has(x.code));
const status = structural ? 'CONFLICT' : unresolved ? 'INCOMPLETE' : 'PASS';

const report = {
  schemaVersion: '1.0.0',
  status,
  reconciliationGreen: status === 'PASS',
  inventoryEndpointCount: inventoryEndpoints.length,
  domainOperationCount: domainOperations.length,
  canonicalOpenapiEndpointCount: openapiEndpoints.size,
  matchCount: summary.MATCH ?? 0,
  findingCount: findings.length,
  summary,
  failures,
  findings,
  normalization: { inventoryPrefix: '/v1', domainPrefix: '/', canonicalServerPrefix: '/api/v1', normalizedPrefix: '/api/v1' },
  rule: 'PASS requires zero structural conflicts and zero unresolved three-way endpoint mappings. This report is derived evidence and is not a source of truth.'
};

const evidenceDir = path.join(root, 'artifacts', 'api-inventory');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'endpoint-registry-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(status === 'PASS' ? 0 : 1);
