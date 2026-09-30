import fs from 'node:fs';

const root = process.cwd();
const read = (p) => JSON.parse(fs.readFileSync(`${root}/${p}`, 'utf8'));
const write = (p, value) => fs.writeFileSync(`${root}/${p}`, `${JSON.stringify(value, null, 2)}\n`);
const fail = (message) => { console.error(`FIVE_WAY_RECONCILIATION_BLOCKED: ${message}`); process.exit(1); };

const paths = {
  features: 'contracts/alignment/feature-inventory.v1.json',
  db: 'contracts/alignment/database-entity-persistence-inventory.v1.json',
  api: 'contracts/alignment/api-inventory.v1.json',
  payload: 'contracts/alignment/payload-inventory.v1.json',
  code: 'contracts/alignment/code-evidence-inventory.v1.json',
  mapping: 'contracts/alignment/cross-system-mapping.v1.json',
  output: 'contracts/alignment/five-way-reconciliation.v1.json',
};
for (const p of Object.values(paths)) {
  if (p === paths.output) continue;
  if (!fs.existsSync(`${root}/${p}`)) fail(`missing ${p}`);
}

const features = read(paths.features);
const db = read(paths.db);
const api = read(paths.api);
const payload = read(paths.payload);
const code = read(paths.code);
const mapping = read(paths.mapping);

if (!Array.isArray(features.features) || features.features.length === 0) fail('feature inventory is empty');
if (!Array.isArray(mapping.records)) fail('cross-system mapping records are missing');

const mappingsByFeature = new Map();
for (const record of mapping.records) {
  if (mappingsByFeature.has(record.featureId)) fail(`duplicate mapping for feature ${record.featureId}`);
  mappingsByFeature.set(record.featureId, record);
}

const blockers = [];
const records = [];
for (const feature of features.features) {
  const mappingRecord = mappingsByFeature.get(feature.featureId);
  if (!mappingRecord) {
    records.push({ featureId: feature.featureId, status: 'UNRESOLVED', evidence: [feature.sourceRef], blockers: ['No explicit cross-system mapping record'] });
    blockers.push(feature.featureId);
    continue;
  }
  const status = mappingRecord.status;
  const evidence = [feature.sourceRef, ...(mappingRecord.evidence ?? [])];
  const recordBlockers = [...(mappingRecord.blockers ?? [])];
  if (!['MATCH', 'MAPPED'].includes(status)) blockers.push(feature.featureId);
  records.push({
    featureId: feature.featureId,
    status,
    entityIds: mappingRecord.entityIds ?? [],
    apiOperationIds: mappingRecord.apiOperationIds ?? [],
    payloadCollections: mappingRecord.payloadCollections ?? [],
    codeEvidenceRefs: mappingRecord.codeEvidenceRefs ?? [],
    evidence: [...new Set(evidence)],
    blockers: [...new Set(recordBlockers)],
  });
}

for (const mappingRecord of mapping.records) {
  if (!features.features.some((feature) => feature.featureId === mappingRecord.featureId)) {
    records.push({ featureId: mappingRecord.featureId, status: 'EXTRA', evidence: mappingRecord.evidence ?? [], blockers: ['Mapping references a feature absent from Blueprint inventory'] });
    blockers.push(mappingRecord.featureId);
  }
}

const unresolvedInventory = [
  ['db', db.status],
  ['api', api.status],
  ['payload', payload.status],
  ['code', code.status],
].filter(([, status]) => status !== 'DISCOVERED');

if (unresolvedInventory.length > 0) {
  for (const [name, status] of unresolvedInventory) blockers.push(`${name}:${status}`);
}

const outputStatus = blockers.length === 0 ? 'GREEN' : 'NOT_GREEN';
write(paths.output, {
  version: '1.0.0',
  status: outputStatus,
  sourceOfTruth: 'contracts/alignment/five-way-alignment.v1.json',
  generatedBy: 'scripts/build-five-way-reconciliation.mjs',
  records,
  blockers: [...new Set(blockers)].sort(),
  inventoryStatus: {
    features: features.status,
    db: db.status,
    api: api.status,
    payload: payload.status,
    code: code.status,
    mapping: mapping.status,
  },
});

if (outputStatus !== 'GREEN') {
  console.error(`Five-way reconciliation NOT_GREEN: ${new Set(blockers).size} blocker(s)`);
  process.exit(1);
}
console.log(`Five-way reconciliation GREEN: ${records.length} feature records`);
