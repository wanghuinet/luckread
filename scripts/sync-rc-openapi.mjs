import fs from 'node:fs';
import path from 'node:path';

const file = 'contracts/openapi/v1/openapi.yaml';
const raw = fs.readFileSync(file, 'utf8');
const inventoryDir = 'contracts/api';

function operationFiles() {
  return fs.readdirSync(inventoryDir)
    .filter((name) => name.endsWith('-operation-policy.v1.json'))
    .sort();
}

const canonicalPathOverrides = new Map([
  ['reportInteractionResource', '/interactions/reports'],
]);

function readOperations() {
  const out = [];
  for (const name of operationFiles()) {
    const doc = JSON.parse(fs.readFileSync(path.join(inventoryDir, name), 'utf8'));
    if (!Array.isArray(doc.operations)) continue;
    for (const op of doc.operations) {
      if (!op?.operationId || !op.method || !op.path) continue;
      out.push({ ...op, path: canonicalPathOverrides.get(op.operationId) ?? op.path, source: name });
    }
  }
  return out;
}

function existingOperations(text) {
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s+operationId:\s*([^#\s]+)/);
    if (match) set.add(match[1]);
  }
  return set;
}

function pathParameters(route) {
  const names = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (!names.length) return '';
  return `    parameters:\n${names.map((name) => `      - name: ${name}\n        in: path\n        required: true\n        schema: { $ref: '#/components/schemas/ResourceId' }`).join('\n')}\n`;
}

function block(op) {
  const method = String(op.method).toLowerCase();
  const status = method === 'delete' ? '204' : '200';
  const response = method === 'delete' ? 'Deleted.' : 'Operation completed.';
  const body = ['post', 'put', 'patch'].includes(method)
    ? `      requestBody:\n        required: false\n        content:\n          application/json:\n            schema: { type: object, additionalProperties: true }\n`
    : '';
  return `  ${op.path}:\n${pathParameters(op.path)}    ${method}:\n      tags: [API]\n      summary: Canonical ${op.operationId}\n      operationId: ${op.operationId}\n${body}      responses:\n        '${status}': { description: ${response} }\n        '4XX': { $ref: '#/components/responses/ClientError' }`;
}

const interactionPolicyFile = path.join(inventoryDir, 'interaction-operation-policy.v1.json');
if (fs.existsSync(interactionPolicyFile)) {
  const interactionDoc = JSON.parse(fs.readFileSync(interactionPolicyFile, 'utf8'));
  let changed = false;
  for (const op of interactionDoc.operations ?? []) {
    if (op.operationId === 'reportInteractionResource' && op.path !== '/interactions/reports') {
      op.path = '/interactions/reports';
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(interactionPolicyFile, JSON.stringify(interactionDoc, null, 2) + '\n');
    console.log('normalized reportInteractionResource path to /interactions/reports');
  }
}

function syncOperationPolicy() {
  const policyFile = 'contracts/openapi/v1/operation-policy.json';
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  const existing = new Map((policy.operations ?? []).map((op) => [op.operationId, op]));
  const inventoryOps = readOperations();
  let changed = false;
  for (const op of inventoryOps) {
    if (existing.has(op.operationId)) continue;
    const required = op.authorization?.required === true;
    const permission = op.authorization?.permission;
    const stateMachineRequired = op.stateMachine?.required === true;
    policy.operations.push({
      operationId: op.operationId,
      auth: { mode: stateMachineRequired ? 'state-machine' : required ? (permission ? 'permission' : 'authenticated') : 'public' },
      permissions: permission ? [permission] : [],
      stateMachine: stateMachineRequired ? (op.operationId.toLowerCase().includes('account') ? 'account' : 'content') : 'none',
      idempotencyRequired: op.idempotency?.required === true,
      optimisticLockRequired: op.retry?.requiresOptimisticConcurrency === true,
      auditRequired: true
    });
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2) + '\n');
    console.log(`synchronized ${policy.operations.length - existing.size} domain inventory operations into ${policyFile}`);
  }
}

syncOperationPolicy();

const ops = readOperations();
const seenRoute = new Map();
for (const op of ops) {
  const key = `${String(op.method).toUpperCase()} ${op.path}`;
  const prior = seenRoute.get(key);
  if (prior && prior.operationId !== op.operationId) {
    throw new Error(`AMBIGUOUS_CANONICAL_ROUTE ${key}: ${prior.operationId} vs ${op.operationId}`);
  }
  seenRoute.set(key, op);
}

const existing = existingOperations(raw);
const missing = ops.filter((op) => !existing.has(op.operationId));
if (!missing.length) {
  console.log('canonical OpenAPI already contains all domain inventory operations');
  process.exit(0);
}

const marker = '\ncomponents:\n';
const index = raw.indexOf(marker);
if (index < 0) throw new Error('canonical OpenAPI components marker not found');

const insertion = `\n${missing.map(block).join('\n\n')}\n`;
fs.writeFileSync(file, raw.slice(0, index) + insertion + raw.slice(index));
console.log(`added ${missing.length} domain inventory operations to ${file}`);
