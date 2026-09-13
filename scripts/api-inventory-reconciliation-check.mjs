#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inventoryDir = path.join(root, 'contracts', 'api');
const openapiPolicy = path.join(root, 'contracts', 'openapi', 'v1', 'operation-policy.json');
const failures = [];
const findings = [];
const matches = [];
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
else if (!Array.isArray(policy.operations)) failures.push({ code: 'OPENAPI_POLICY_MISSING_OPERATIONS_ARRAY' });
else for (const op of policy.operations) {
  if (!op?.operationId) failures.push({ code: 'OPENAPI_POLICY_MISSING_OPERATION_ID' });
  else if (openapiOps.has(op.operationId)) failures.push({ code: 'OPENAPI_DUPLICATE_OPERATION_ID', operationId: op.operationId });
  else openapiOps.set(op.operationId, op);
}
for (const [id, op] of inventory) {
  const legacy = openapiOps.get(id);
  if (!legacy) {
    finding('UNRECONCILED_INVENTORY_OPERATION', id, 'operationId is not yet represented in legacy OpenAPI operation policy');
    continue;
  }
  const inventoryMethod = String(op.method).toUpperCase();
  const openapiMethod = String(legacy.method ?? '').toUpperCase();
  if (inventoryMethod !== openapiMethod) finding('METHOD_CONFLICT', id, `inventory=${inventoryMethod} openapi=${openapiMethod}`);
  else if (op.path !== legacy.path) finding('PATH_CONFLICT', id, `inventory=${op.path} openapi=${legacy.path}`);
  else matches.push({ operationId: id, inventory: { method: inventoryMethod, path: op.path }, openapi: { method: openapiMethod, path: legacy.path } });
}
for (const [id] of openapiOps) if (!inventory.has(id)) finding('UNRECONCILED_OPENAPI_OPERATION', id, 'legacy OpenAPI operation is not yet represented in domain inventory');
const criticalEvidence = ['openapi','permission','state','resource','cache','antiAbuse','integration','securityE2E'];
const allowedEvidence = new Set(['PASS', 'N/A']);
for (const [id, op] of inventory) {
  if (!op.evidence) { finding('EVIDENCE_MISSING', id, 'evidence object absent'); continue; }
  for (const field of criticalEvidence) {
    const value = op.evidence[field];
    if (value === undefined || value === null || value === 'MISSING') finding('EVIDENCE_INCOMPLETE', id, field);
    else if (!allowedEvidence.has(value)) finding('EVIDENCE_INVALID', id, `${field}=${String(value)}`);
  }
}
const conflictCodes = new Set(['INVALID_JSON','DUPLICATE_OPERATION_ID','OPENAPI_POLICY_MISSING_OPERATION_ID','OPENAPI_DUPLICATE_OPERATION_ID','MISSING_OPERATION_ID','MISSING_METHOD_OR_PATH','METHOD_CONFLICT','PATH_CONFLICT']);
const incompleteCodes = new Set(['MISSING_API_INVENTORY_DIRECTORY','MISSING_OPENAPI_OPERATION_POLICY','OPENAPI_POLICY_MISSING_OPERATIONS_ARRAY','MISSING_POLICY','MISSING_DOMAIN','MISSING_OPERATIONS_ARRAY','EVIDENCE_MISSING','EVIDENCE_INCOMPLETE','EVIDENCE_INVALID','UNRECONCILED_INVENTORY_OPERATION','UNRECONCILED_OPENAPI_OPERATION']);
const hasConflict = failures.some((x) => conflictCodes.has(x.code)) || findings.some((x) => conflictCodes.has(x.code));
const hasIncomplete = failures.some((x) => incompleteCodes.has(x.code)) || findings.some((x) => incompleteCodes.has(x.code));
const status = hasConflict ? 'CONFLICT' : hasIncomplete ? 'INCOMPLETE' : 'PASS';
const report = { schemaVersion: '1.2.0', generatedAt: new Date().toISOString(), status, reconciliationGreen: status === 'PASS', inventoryCount: inventory.size, openapiPolicyCount: openapiOps.size, failureCount: failures.length, findingCount: findings.length, failures, findings, matches, evidenceSemantics: { pass: ['PASS','N/A'], incomplete: ['MISSING','ABSENT'], invalid: ['unknown_or_unsupported'] }, rule: 'PASS requires zero structural conflicts, zero unresolved inventory membership, and zero incomplete/invalid evidence. N/A is valid only when explicitly declared by the operation contract.' };
const evidenceDir = path.join(root, 'artifacts', 'api-inventory');
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'reconciliation-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exit(status === 'PASS' ? 0 : 1);
