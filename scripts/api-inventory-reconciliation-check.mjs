#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inventoryDir = path.join(root, 'contracts', 'api');
const openapiPolicy = path.join(root, 'contracts', 'openapi', 'v1', 'operation-policy.json');

const failures = [];
const warnings = [];
const inventory = new Map();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { failures.push(`INVALID_JSON:${path.relative(root, file)}:${error.message}`); return null; }
}

function addInventory(op, source) {
  if (!op?.operationId) return failures.push(`MISSING_OPERATION_ID:${source}`);
  const key = op.operationId;
  if (inventory.has(key)) failures.push(`DUPLICATE_OPERATION_ID:${key}:${source}`);
  inventory.set(key, { ...op, __source: source });
  if (!op.method || !op.path) failures.push(`MISSING_METHOD_OR_PATH:${key}:${source}`);
  for (const field of ['authorization','resource','cache','retry','event','queue','antiAbuse','idempotency','security','evidence']) {
    if (!op[field]) failures.push(`MISSING_POLICY:${key}:${field}:${source}`);
  }
}

if (!fs.existsSync(inventoryDir)) failures.push('MISSING_API_INVENTORY_DIRECTORY');
else {
  for (const file of fs.readdirSync(inventoryDir).filter((f) => f.endsWith('-operation-policy.v1.json')).sort()) {
    const full = path.join(inventoryDir, file);
    const doc = readJson(full);
    if (!doc) continue;
    if (!doc.domain) failures.push(`MISSING_DOMAIN:${file}`);
    if (!Array.isArray(doc.operations)) failures.push(`MISSING_OPERATIONS_ARRAY:${file}`);
    else for (const op of doc.operations) addInventory(op, file);
  }
}

const policy = fs.existsSync(openapiPolicy) ? readJson(openapiPolicy) : null;
const openapiOps = new Map();
if (!policy) failures.push('MISSING_OPENAPI_OPERATION_POLICY');
else {
  const ops = Array.isArray(policy.operations) ? policy.operations : [];
  for (const op of ops) {
    if (!op?.operationId) { failures.push('OPENAPI_POLICY_MISSING_OPERATION_ID'); continue; }
    if (openapiOps.has(op.operationId)) failures.push(`OPENAPI_DUPLICATE_OPERATION_ID:${op.operationId}`);
    openapiOps.set(op.operationId, op);
  }
}

for (const [id, op] of inventory) {
  if (openapiOps.size && !openapiOps.has(id)) warnings.push(`INVENTORY_NOT_IN_OPENAPI:${id}`);
}
for (const [id] of openapiOps) {
  if (!inventory.has(id)) warnings.push(`OPENAPI_NOT_IN_INVENTORY:${id}`);
}

const criticalEvidence = ['openapi','permission','state','resource','cache','antiAbuse','integration','securityE2E'];
for (const [id, op] of inventory) {
  for (const field of criticalEvidence) {
    if (op.evidence?.[field] === 'MISSING') warnings.push(`EVIDENCE_MISSING:${id}:${field}`);
  }
}

const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  inventoryCount: inventory.size,
  openapiPolicyCount: openapiOps.size,
  failureCount: failures.length,
  warningCount: warnings.length,
  green: failures.length === 0,
  failures,
  warnings,
  rule: 'Warnings never become Green; missing evidence remains incomplete until an authoritative gate supplies evidence.'
};

const evidenceDir = path.join(root, 'artifacts', 'api-inventory');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'reconciliation-report.json'), JSON.stringify(report, null, 2) + '\n');

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exit(1);
