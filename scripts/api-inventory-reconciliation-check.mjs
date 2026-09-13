#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inventoryDir = path.join(root, 'contracts', 'api');
const openapiPolicy = path.join(root, 'contracts', 'openapi', 'v1', 'operation-policy.json');
const failures = [];
const findings = [];
const inventory = new Map();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { failures.push({ code: 'INVALID_JSON', source: path.relative(root, file), message: error.message }); return null; }
}
function finding(code, operationId, detail) { findings.push({ code, operationId: operationId ?? null, detail }); }
function addInventory(op, source) {
  if (!op?.operationId) return failures.push({ code: 'MISSING_OPERATION_ID', source });
  const id = op.operationId;
  if (inventory.has(id)) failures.push({ code: 'DUPLICATE_OPERATION_ID', operationId: id, source });
  inventory.set(id, { ...op, __source: source });
  if (!op.method || !op.path) failures.push({ code: 'MISSING_METHOD_OR_PATH', operationId: id, source });
  for (const field of ['authorization','resource','cache','retry','event','queue','antiAbuse','idempotency','security','evidence']) {
    if (!op[field]) finding('MISSING_POLICY', id, field);
  }
}

if (!fs.existsSync(inventoryDir)) failures.push({ code: 'MISSING_API_INVENTORY_DIRECTORY' });
else for (const file of fs.readdirSync(inventoryDir).filter((f) => f.endsWith('-operation-policy.v1.json')).sort()) {
  const doc = readJson(path.join(inventoryDir, file));
  if (!doc) continue;
  if (!doc.domain) finding('MISSING_DOMAIN', null, file);
  if (!Array.isArray(doc.operations)) finding('MISSING_OPERATIONS_ARRAY', null, file);
  else doc.operations.forEach((op) => addInventory(op, file));
}

const policy = fs.existsSync(openapiPolicy) ? readJson(openapiPolicy) : null;
const openapiOps = new Map();
if (!policy) failures.push({ code: 'MISSING_OPENAPI_OPERATION_POLICY' });
else for (const op of Array.isArray(policy.operations) ? policy.operations : []) {
  if (!op?.operationId) failures.push({ code: 'OPENAPI_POLICY_MISSING_OPERATION_ID' });
  else if (openapiOps.has(op.operationId)) failures.push({ code: 'OPENAPI_DUPLICATE_OPERATION_ID', operationId: op.operationId });
  else openapiOps.set(op.operationId, op);
}

// Legacy OpenAPI policy is treated as a reconciliation reference, not a complete
// inventory authority. Missing counterparts are unresolved until explicitly reconciled.
for (const [id, op] of inventory) {
  const legacy = openapiOps.get(id);
  if (!legacy) finding('UNRECONCILED_INVENTORY_OPERATION', id, 'operationId absent from legacy OpenAPI operation policy');
  else {
    if (String(op.method).toUpperCase() !== String(legacy.method ?? '').toUpperCase()) finding('METHOD_MISMATCH', id, `${op.method} != ${legacy.method}`);
    if (op.path !== legacy.path) finding('PATH_MISMATCH', id, `${op.path} != ${legacy.path}`);
  }
}
for (const [id] of openapiOps) if (!inventory.has(id)) finding('UNRECONCILED_OPENAPI_OPERATION', id, 'operationId absent from domain inventory');

const criticalEvidence = ['openapi','permission','state','resource','cache','antiAbuse','integration','securityE2E'];
const allowedEvidence = new Set(['PASS', 'N/A']);
for (const [id, op] of inventory) {
  if (!op.evidence) { finding('EVIDENCE_MISSING', id, 'evidence object absent'); continue; }
  for (const field of criticalEvidence) {
    const value = op.evidence[field];
    if (value === undefined || value === null || value === 'MISSING') finding('EVIDENCE_INCOMPLETE', id, field);
    else if (!allowedEvidence.has(value)) finding('EVIDENCE_NOT_PASS', id, `${field}=${value}`);
  }
}

const conflictCodes = new Set([
  'INVALID_JSON','DUPLICATE_OPERATION_ID','OPENAPI_POLICY_MISSING_OPERATION_ID',
  'OPENAPI_DUPLICATE_OPERATION_ID','MISSING_OPERATION_ID','MISSING_METHOD_OR_PATH',
  'METHOD_MISMATCH','PATH_MISMATCH'
]);
const incompleteCodes = new Set([
  'MISSING_API_INVENTORY_DIRECTORY','MISSING_OPENAPI_OPERATION_POLICY','MISSING_POLICY',
  'MISSING_DOMAIN','MISSING_OPERATIONS_ARRAY','EVIDENCE_MISSING','EVIDENCE_INCOMPLETE',
  'EVIDENCE_NOT_PASS','UNRECONCILED_INVENTORY_OPERATION','UNRECONCILED_OPENAPI_OPERATION'
]);
const hasConflict = failures.some((x) => conflictCodes.has(x.code)) || findings.some((x) => conflictCodes.has(x.code));
const hasIncomplete = failures.some((x) => incompleteCodes.has(x.code)) || findings.some((x) => incompleteCodes.has(x.code));
const status = hasConflict ? 'CONFLICT' : hasIncomplete ? 'INCOMPLETE' : 'PASS';
const report = {
  schemaVersion: '1.2.0',
  generatedAt: new Date().toISOString(),
  status,
  reconciliationGreen: status === 'PASS',
  inventoryCount: inventory.size,
  openapiPolicyCount: openapiOps.size,
  failureCount: failures.length,
  findingCount: findings.length,
  failures,
  findings,
  evidenceSemantics: { pass: ['PASS','N/A'], incomplete: ['MISSING','ABSENT'], invalid: ['unknown_or_unsupported'] },
  rule: 'PASS requires zero structural conflicts and zero unresolved reconciliation or incomplete evidence. N/A is valid only when explicitly declared by the operation contract.'
};
const evidenceDir = path.join(root, 'artifacts', 'api-inventory');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'reconciliation-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(status === 'PASS' ? 0 : 1);
