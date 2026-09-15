import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const batchDir = path.join(root, 'contracts/alignment/mapping-batches');
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json');
const outPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json');

const BLOCKING = new Set(['MISSING','EXTRA','DRIFT','CONFLICT','DUPLICATE','UNRESOLVED','BLOCKED']);
const REQUIRED_KEYS = ['featureId','status','apiOperationIds','entityIds','payloadCollections','codeEvidenceRefs','evidence','blockers'];

function fail(message) {
  console.error(`MAPPING_CONSOLIDATION_BLOCKED: ${message}`);
  process.exit(1);
}
function readJson(file) {
  if (!fs.existsSync(file)) fail(`missing input: ${path.relative(root, file)}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`invalid JSON: ${path.relative(root, file)}: ${error.message}`); }
}

if (!fs.existsSync(batchDir)) fail('mapping batch directory is missing');
const batchFiles = fs.readdirSync(batchDir)
  .filter((name) => name.endsWith('.json'))
  .sort();
if (batchFiles.length === 0) fail('no mapping batch files discovered');

const featureInventory = readJson(featurePath);
const featureRecords = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records)
    ? featureInventory.records
    : [];
const masterIds = featureRecords.map((record) => record.featureId).filter(Boolean).sort();
if (masterIds.length === 0) fail('feature inventory contains no canonical Feature IDs');
const masterSet = new Set(masterIds);

const byId = new Map();
const sourceFiles = new Map();
const invalid = [];

for (const file of batchFiles) {
  const full = path.join(batchDir, file);
  const batch = readJson(full);
  if (!Array.isArray(batch.records)) fail(`${file}: records must be an array`);
  for (const record of batch.records) {
    for (const key of REQUIRED_KEYS) {
      if (!(key in record)) invalid.push(`${file}: ${record.featureId ?? '<unknown>'}: missing ${key}`);
    }
    if (!record.featureId) continue;
    if (!masterSet.has(record.featureId)) invalid.push(`${file}: ${record.featureId}: not present in canonical feature inventory`);
    if (byId.has(record.featureId)) {
      invalid.push(`${file}: ${record.featureId}: duplicate Feature ID; already supplied by ${sourceFiles.get(record.featureId)}`);
      continue;
    }
    byId.set(record.featureId, record);
    sourceFiles.set(record.featureId, file);
  }
}

const missing = masterIds.filter((id) => !byId.has(id));
if (missing.length) invalid.push(`canonical features missing from mapping batches: ${missing.join(', ')}`);
if (invalid.length) fail(invalid.join('\n'));

const records = masterIds.map((id) => {
  const record = byId.get(id);
  const normalized = {
    featureId: id,
    status: record.status,
    apiOperationIds: [...(record.apiOperationIds ?? [])].sort(),
    entityIds: [...(record.entityIds ?? [])].sort(),
    payloadCollections: [...(record.payloadCollections ?? [])].sort(),
    codeEvidenceRefs: [...(record.codeEvidenceRefs ?? [])].sort(),
    ...(record.securityIds ? { securityIds: [...record.securityIds].sort() } : {}),
    ...(record.lifecycleIds ? { lifecycleIds: [...record.lifecycleIds].sort() } : {}),
    evidence: [...(record.evidence ?? [])].sort(),
    blockers: [...(record.blockers ?? [])].sort(),
  };
  return normalized;
});

const blockers = records.filter((record) => BLOCKING.has(record.status) || record.blockers.length > 0);
const status = blockers.length === 0 ? 'GREEN' : 'NOT_GREEN';
const output = {
  version: '1.0.0',
  status,
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md + contracts/alignment/feature-inventory.v1.json',
  generatedBy: 'scripts/consolidate-mapping-batches.mjs',
  generatedDeterministically: true,
  recordCount: records.length,
  blockers: blockers.length ? [
    `Canonical mapping is NOT_GREEN: ${blockers.length} Feature IDs retain blocking status or explicit blockers.`,
    'Unresolved mappings are preserved; this consolidator never invents API/DTO/entity/field/Persistence/Payload/security/lifecycle/code/test evidence.',
  ] : [],
  records,
};

fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`MAPPING_CONSOLIDATION: ${status}; records=${records.length}; blocking=${blockers.length}`);
if (status !== 'GREEN') process.exitCode = 2;
