import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const catalog = readJson('contracts/entity/entity-catalog.v1.json');
const evidence = readJson('contracts/entity/entity-implementation-evidence.v1.json');
const errors = [];

if (evidence.version !== '1.0') errors.push(`unsupported evidence version: ${evidence.version}`);
if (evidence.sourceOfTruth !== 'contracts/entity/entity-catalog.v1.json') errors.push('evidence sourceOfTruth mismatch');

const catalogIds = catalog.records.map((r) => r.entityId);
const evidenceIds = evidence.records.map((r) => r.entityId);
const duplicates = (xs) => xs.filter((x, i) => xs.indexOf(x) !== i);

for (const id of duplicates(catalogIds)) errors.push(`duplicate catalog entity: ${id}`);
for (const id of duplicates(evidenceIds)) errors.push(`duplicate evidence entity: ${id}`);
for (const id of evidenceIds) if (!catalogIds.includes(id)) errors.push(`unknown evidence entity: ${id}`);
for (const id of catalogIds) if (!evidenceIds.includes(id)) errors.push(`missing implementation evidence: ${id}`);

const byId = new Map(evidence.records.map((r) => [r.entityId, r]));
for (const entity of catalog.records) {
  const r = byId.get(entity.entityId);
  if (!r) continue;
  if (r.catalogStatus !== entity.status) errors.push(`${entity.entityId}: catalogStatus mismatch (${r.catalogStatus} vs ${entity.status})`);
  if (entity.status === 'VERIFIED' && r.implementationStatus !== 'IMPLEMENTED') {
    errors.push(`${entity.entityId}: VERIFIED catalog entity must be IMPLEMENTED`);
  }
  if (r.implementationStatus === 'IMPLEMENTED' && r.implementationRefs.length === 0) {
    errors.push(`${entity.entityId}: IMPLEMENTED requires implementationRefs`);
  }
  if (r.status === 'VERIFIED' && r.implementationStatus !== 'IMPLEMENTED') {
    errors.push(`${entity.entityId}: VERIFIED evidence status requires IMPLEMENTED`);
  }
  if (r.status === 'VERIFIED' && r.blockers.length > 0) {
    errors.push(`${entity.entityId}: VERIFIED evidence cannot retain blockers`);
  }
}

if (errors.length) {
  console.error('ENTITY_IMPLEMENTATION_EVIDENCE_GATE=BLOCKED');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log(`ENTITY_IMPLEMENTATION_EVIDENCE_GATE=${evidence.status === 'GREEN' ? 'PASS' : 'NOT_GREEN'}`);
