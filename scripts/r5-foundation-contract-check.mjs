import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const errors = [];

const files = {
  api: 'contracts/api/feature-api-operation-registry.v1.json',
  authz: 'contracts/authz/feature-action-permission-registry.v1.json',
  state: 'contracts/state/feature-state-registry.v1.json',
  blueprint: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md',
};

for (const key of ['api','authz','state']) {
  if (!fs.existsSync(path.join(root, files[key]))) errors.push(`missing ${key} registry`);
}
if (errors.length) {
  console.error('R5_FOUNDATION_GATE=BLOCKED');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}

const api = readJson(files.api);
const authz = readJson(files.authz);
const state = readJson(files.state);

for (const [name, doc] of [['api',api],['authz',authz],['state',state]]) {
  if (doc.version !== '1.0') errors.push(`${name}: unsupported version ${doc.version}`);
  if (doc.sourceOfTruth !== files.blueprint) errors.push(`${name}: sourceOfTruth must be canonical Blueprint`);
  if (!['NOT_GREEN','GREEN'].includes(doc.status)) errors.push(`${name}: invalid status ${doc.status}`);
  if (!Array.isArray(doc.records)) errors.push(`${name}: records must be an array`);
  const ids = (doc.records ?? []).map((r) => r.featureId);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  [...new Set(dup)].forEach((id) => errors.push(`${name}: duplicate featureId ${id}`));
}

const checkRegistry = (name, records, required) => {
  const ids = new Set();
  for (const r of records) {
    if (!r || typeof r !== 'object') { errors.push(`${name}: invalid record`); continue; }
    if (!r.featureId) errors.push(`${name}: missing featureId`);
    if (ids.has(r.featureId)) continue;
    ids.add(r.featureId);
    for (const key of required) {
      if (r[key] === undefined || r[key] === null || (Array.isArray(r[key]) && r[key].length === 0)) {
        errors.push(`${name}: ${r.featureId} missing required ${key}`);
      }
    }
    if (r.status === 'VERIFIED' && (!Array.isArray(r.evidenceRefs) || r.evidenceRefs.length === 0)) {
      errors.push(`${name}: VERIFIED ${r.featureId} requires evidenceRefs`);
    }
  }
};

checkRegistry('api', api.records, ['domainId','operationId','method','path','primaryWorker','status','evidenceRefs']);
checkRegistry('authz', authz.records, ['domainId','actionId','permissionIds','scope','status','evidenceRefs']);
checkRegistry('state', state.records, ['domainId','stateMachineId','stateField','versionField','status','evidenceRefs']);

const byFeature = (records) => new Map(records.map((r) => [r.featureId, r]));
const apiBy = byFeature(api.records);
const authzBy = byFeature(authz.records);
const stateBy = byFeature(state.records);

for (const featureId of new Set([...apiBy.keys(), ...authzBy.keys(), ...stateBy.keys()])) {
  const present = [apiBy.has(featureId), authzBy.has(featureId), stateBy.has(featureId)];
  const resolved = present.filter(Boolean).length;
  if (resolved > 0 && resolved < 3) {
    errors.push(`R5 cross-registry orphan: ${featureId} must resolve API + Action/Permission + State together`);
  }
}

// A NOT_GREEN registry intentionally blocks promotion; this is a governance gate, not a claim of implementation.
if (errors.length) {
  console.error('R5_FOUNDATION_GATE=BLOCKED');
  errors.forEach((e) => console.error(`- ${e}`));
  process.exit(1);
}

const green = api.status === 'GREEN' && authz.status === 'GREEN' && state.status === 'GREEN';
console.log(`R5_FOUNDATION_GATE=${green ? 'PASS' : 'NOT_GREEN'}`);
console.log(`R5_RECORDS=api:${api.records.length},authz:${authz.records.length},state:${state.records.length}`);
