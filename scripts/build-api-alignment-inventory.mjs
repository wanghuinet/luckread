import fs from 'node:fs';

const root = process.cwd();
const openapiPath = 'contracts/openapi/v1/openapi.yaml';
const apiInventoryPath = 'contracts/api/api-inventory.v1.json';
const featureInventoryPath = 'contracts/alignment/feature-inventory.v1.json';
const outPath = 'contracts/alignment/api-inventory.v1.json';

const fail = (message) => {
  console.error(`API alignment inventory blocked: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(openapiPath)) fail(`missing ${openapiPath}`);
if (!fs.existsSync(apiInventoryPath)) fail(`missing ${apiInventoryPath}`);
if (!fs.existsSync(featureInventoryPath)) fail(`missing ${featureInventoryPath}; build the canonical feature inventory first`);

const openapiRaw = fs.readFileSync(openapiPath, 'utf8');
const inventory = JSON.parse(fs.readFileSync(apiInventoryPath, 'utf8'));
const featureInventory = JSON.parse(fs.readFileSync(featureInventoryPath, 'utf8'));
const knownFeatureIds = new Set((featureInventory.features ?? []).map((feature) => feature.featureId));
const operationFeatureMap = inventory.operation_feature_map ?? {};

// Lightweight OpenAPI path/operation extraction with no `yaml` runtime
// dependency. Mirrors scripts/sync-rc-openapi.mjs, which already removed the
// undeclared `yaml` import for the same contract-first document.
const serverUrlMatch = openapiRaw.match(/^servers:\s*\n\s*-\s*url:\s*([^\s#]+)/m);
const serverUrl = String(serverUrlMatch?.[1] ?? '').replace(/\/$/, '');

const operations = [];
{
  const lines = openapiRaw.split(/\r?\n/);
  let currentPath = null;
  let currentMethod = null;
  let currentOperationId = null;
  const flush = () => {
    if (currentPath && currentMethod && currentOperationId) {
      operations.push({ operationId: currentOperationId, method: currentMethod, rawPath: currentPath });
    }
    currentOperationId = null;
  };
  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:#]+):\s*$/);
    if (pathMatch) { flush(); currentPath = pathMatch[1].trim(); currentMethod = null; continue; }
    const methodMatch = line.match(/^    (get|post|put|patch|delete|head|options|trace):\s*$/i);
    if (methodMatch && currentPath) { flush(); currentMethod = methodMatch[1].toUpperCase(); continue; }
    if (!currentPath || !currentMethod) continue;
    const operationMatch = line.match(/^(\s+)operationId:\s*([^#\s]+)/);
    if (operationMatch) currentOperationId = operationMatch[2].trim();
  }
  flush();
}

const openapiOperationIds = new Set(operations.map((operation) => operation.operationId));
for (const [operationId, mapping] of Object.entries(operationFeatureMap)) {
  if (!openapiOperationIds.has(operationId)) fail(`operation_feature_map references unknown OpenAPI operationId '${operationId}'`);
  if (!mapping || !Array.isArray(mapping.feature_ids) || mapping.feature_ids.length === 0) {
    fail(`operation_feature_map '${operationId}' must declare a non-empty feature_ids array`);
  }
  if (new Set(mapping.feature_ids).size !== mapping.feature_ids.length) {
    fail(`operation_feature_map '${operationId}' contains duplicate feature IDs`);
  }
  for (const featureId of mapping.feature_ids) {
    if (!knownFeatureIds.has(featureId)) fail(`operation_feature_map '${operationId}' references unknown canonical feature '${featureId}'`);
  }
  const schemaRef = mapping.schema_ref ?? '';
  if (typeof schemaRef !== 'string') fail(`operation_feature_map '${operationId}' schema_ref must be a string`);
  if (schemaRef) {
    const schemaPath = schemaRef.split('#', 1)[0];
    if (!fs.existsSync(schemaPath)) fail(`operation_feature_map '${operationId}' references missing schema contract '${schemaPath}'`);
  }
}

const versionPrefix = '/v1';
const canonicalizePath = (rawPath) => {
  const path = String(rawPath);
  if (path.startsWith(versionPrefix + '/')) return path;
  if (serverUrl.endsWith(versionPrefix) && path.startsWith('/')) return `${versionPrefix}${path}`;
  return path;
};

const groups = inventory.domains ?? {};
const declared = new Map();
for (const [domain, group] of Object.entries(groups)) {
  for (const raw of group.endpoint_groups ?? []) {
    const match = String(raw).match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/v1\/\S+)$/);
    if (!match) fail(`invalid API inventory endpoint '${raw}'`);
    const [, method, path] = match;
    const key = `${method} ${path}`;
    if (declared.has(key)) fail(`duplicate API inventory endpoint '${key}'`);
    declared.set(key, { method, path, domain });
  }
}

const records = [];
const seenCanonical = new Set();
const missingFromInventory = [];
for (const op of operations) {
  const canonicalPath = canonicalizePath(op.rawPath);
  if (!canonicalPath.startsWith('/v1/')) continue;
  const upper = op.method.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(upper)) continue;
  const key = `${upper} ${canonicalPath}`;
  if (seenCanonical.has(key)) fail(`duplicate canonical OpenAPI endpoint '${key}'`);
  seenCanonical.add(key);
  const declaration = declared.get(key);
  if (!declaration) {
    missingFromInventory.push(key);
    continue;
  }
  const featureMapping = operationFeatureMap[op.operationId] ?? {};
  records.push({
    operationId: op.operationId,
    method: upper,
    path: canonicalPath,
    openapiPath: op.rawPath,
    domain: declaration.domain,
    status: 'DISCOVERED',
    featureIds: featureMapping.feature_ids ?? [],
    schemaRef: featureMapping.schema_ref ?? '',
    openapiRef: `${openapiPath}#${op.method.toLowerCase()}:${op.rawPath}`,
    sourceRefs: [openapiPath, apiInventoryPath, ...(featureMapping.feature_ids ? [featureInventoryPath] : [])],
  });
}

const missingFromOpenAPI = [];
for (const [key] of declared) {
  const separator = key.indexOf(' ');
  const method = key.slice(0, separator);
  const canonicalPath = key.slice(separator + 1);
  const matchingRecord = records.find((record) => record.method === method && record.path === canonicalPath);
  if (!matchingRecord) missingFromOpenAPI.push(key);
}

if (missingFromInventory.length || missingFromOpenAPI.length) {
  console.error(`API alignment inventory blocked: missingFromInventory=${missingFromInventory.length}; missingFromOpenAPI=${missingFromOpenAPI.length}`);
  for (const key of missingFromInventory) console.error(`  OPENAPI_NOT_DECLARED: ${key}`);
  for (const key of missingFromOpenAPI) console.error(`  INVENTORY_NOT_IN_OPENAPI: ${key}`);
  process.exit(1);
}

records.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
const output = {
  version: '1.0.0',
  status: 'DISCOVERED',
  sourceOfTruth: 'contracts/openapi/v1/openapi.yaml + contracts/api/api-inventory.v1.json',
  generatedBy: 'scripts/build-api-alignment-inventory.mjs',
  serverPrefix: serverUrl || null,
  records,
};
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`API alignment inventory: ${records.length} canonical operations discovered`);