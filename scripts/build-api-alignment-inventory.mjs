import fs from 'node:fs';
import yaml from 'yaml';

const root = process.cwd();
const openapiPath = 'contracts/openapi/v1/openapi.yaml';
const apiInventoryPath = 'contracts/api/api-inventory.v1.json';
const outPath = 'contracts/alignment/api-inventory.v1.json';

const fail = (message) => {
  console.error(`API alignment inventory blocked: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(openapiPath)) fail(`missing ${openapiPath}`);
if (!fs.existsSync(apiInventoryPath)) fail(`missing ${apiInventoryPath}`);

const openapi = yaml.parse(fs.readFileSync(openapiPath, 'utf8'));
const inventory = JSON.parse(fs.readFileSync(apiInventoryPath, 'utf8'));
const paths = openapi?.paths;
if (!paths || typeof paths !== 'object') fail('canonical OpenAPI paths are missing');

const serverUrl = String(openapi?.servers?.[0]?.url ?? '').replace(/\/$/, '');
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
for (const [rawPath, pathItem] of Object.entries(paths)) {
  const canonicalPath = canonicalizePath(rawPath);
  if (!canonicalPath.startsWith('/v1/')) continue;
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!['get','post','put','patch','delete','head','options'].includes(method)) continue;
    const upper = method.toUpperCase();
    const key = `${upper} ${canonicalPath}`;
    if (seenCanonical.has(key)) fail(`duplicate canonical OpenAPI endpoint '${key}'`);
    seenCanonical.add(key);
    const declaration = declared.get(key);
    const operationId = operation?.operationId;
    if (!operationId) fail(`OpenAPI operationId missing for ${key}`);
    if (!declaration) {
      missingFromInventory.push(key);
      continue;
    }
    records.push({
      operationId,
      method: upper,
      path: canonicalPath,
      openapiPath: rawPath,
      domain: declaration.domain,
      status: 'DISCOVERED',
      featureIds: [],
      schemaRef: '',
      openapiRef: `${openapiPath}#${method}:${rawPath}`,
      sourceRefs: [openapiPath, apiInventoryPath],
    });
  }
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