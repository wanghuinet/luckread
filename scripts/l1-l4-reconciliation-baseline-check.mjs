import fs from 'node:fs';

const blueprintPath = 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md';
const baselinePath = 'contracts/capability/l1-l4-reconciliation-baseline.v1.json';

const blueprint = fs.readFileSync(blueprintPath, 'utf8');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const featurePattern = /^-\s+([A-Z][A-Z0-9_]*-\d{3,})\s+(.+)$/gm;
const features = [];
const seen = new Set();
const duplicateFeatureIds = new Set();

let match;
while ((match = featurePattern.exec(blueprint)) !== null) {
  const [, featureId, name] = match;
  if (seen.has(featureId)) duplicateFeatureIds.add(featureId);
  seen.add(featureId);
  features.push({ featureId, name: name.trim() });
}

const registryIds = new Set((baseline.records ?? []).map((r) => r.featureId));
const blueprintOnly = features.filter((f) => !registryIds.has(f.featureId)).map((f) => f.featureId);
const unknownRegistry = [...registryIds].filter((id) => !seen.has(id));
const invalidRecords = (baseline.records ?? []).filter((r) => !r.featureId || !r.hierarchy || !r.hierarchy.l1 || !r.hierarchy.l2 || !r.hierarchy.l3 || !r.hierarchy.l4);

const report = {
  contractVersion: '1.0',
  sourceOfTruth: blueprintPath,
  status: duplicateFeatureIds.size || blueprintOnly.length || unknownRegistry.length || invalidRecords.length ? 'NOT_GREEN' : 'GREEN',
  counts: {
    blueprintFeatures: features.length,
    registryFeatures: registryIds.size,
    blueprintOnly: blueprintOnly.length,
    unknownRegistry: unknownRegistry.length,
    duplicateFeatureIds: duplicateFeatureIds.size,
    invalidRecords: invalidRecords.length,
  },
  duplicateFeatureIds: [...duplicateFeatureIds].sort(),
  blueprintOnly: blueprintOnly.sort(),
  unknownRegistry: unknownRegistry.sort(),
  invalidRecords: invalidRecords.map((r) => r.featureId ?? null),
};

console.log(JSON.stringify(report, null, 2));

if (report.status !== 'GREEN') process.exit(1);
