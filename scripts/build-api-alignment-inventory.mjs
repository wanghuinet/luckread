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
for (const [path, pathItem] of Object.entries(paths)) {
  if (!path.startsWith('/v1/')) continue;
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!['get','post','put','patch','delete','head','options'].includes(method)) continue;
    const upper = method.toUpperCase();
    const key = `${upper} ${path}`;
    const declaration = declared.get(key);
    const operationId = operation?.operationId;
    if (!operationId) fail(`OpenAPI operationId missing for ${key}`);
    if (!declaration) fail(`OpenAPI endpoint not declared by contracts/api/api-inventory.v1.json: ${key}`);
    records.push({
      operationId,
      method: upper,
      path,
      domain: declaration.domain,
      status: 'DRAFT',
      featureIds: [],
      schemaRef: '',
      openapiRef: `${openapiPath}#${method}:${path}`,
      sourceRefs: [openapiPath, apiInventoryPath],
    });
  }
}

for (const [key, declaration] of declared) {
  if (!paths[declaration.path]?.[declaration.method.toLowerCase()]) {
    fail(`API inventory endpoint missing from canonical OpenAPI: ${key}`);
  }
}

records.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
const output = {
  version: '1.0.0',
  status: 'NOT_GREEN',
  sourceOfTruth: 'contracts/openapi/v1/openapi.yaml + contracts/api/api-inventory.v1.json',
  generatedBy: 'scripts/build-api-alignment-inventory.mjs',
  records,
};
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`API alignment inventory: ${records.length} canonical operations discovered`);
