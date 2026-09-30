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

const records = baseline.records ?? [];
const registryIds = new Set(records.map((r) => r.featureId).filter(Boolean));
const blueprintOnly = features.filter((f) => !registryIds.has(f.featureId)).map((f) => f.featureId);
const unknownRegistry = [...registryIds].filter((id) => !seen.has(id));
const malformedRecords = records.filter((r) => !r?.featureId || !r?.hierarchy || !r.hierarchy.l1);
const unresolvedRecords = records.filter((r) => {
  const h = r?.hierarchy ?? {};
  return Boolean(r?.featureId) && (!h.l2 || !h.l3 || !h.l4 || r.reconciliationState === 'UNRESOLVED' || r.reconciliationState === 'BLUEPRINT_ONLY');
});
const invalidAdmissionStates = records.filter((r) => r?.admissionState != null && !['MATCH', 'BLUEPRINT_ONLY_REVIEWED'].includes(r.admissionState));

const report = {
  contractVersion: '1.0',
  sourceOfTruth: blueprintPath,
  status: duplicateFeatureIds.size || blueprintOnly.length || unknownRegistry.length || malformedRecords.length || unresolvedRecords.length || invalidAdmissionStates.length ? 'NOT_GREEN' : 'GREEN',
  counts: {
    blueprintFeatures: features.length,
    registryFeatures: registryIds.size,
    blueprintOnly: blueprintOnly.length,
    unknownRegistry: unknownRegistry.length,
    duplicateFeatureIds: duplicateFeatureIds.size,
    malformedRecords: malformedRecords.length,
    unresolvedRecords: unresolvedRecords.length,
    invalidAdmissionStates: invalidAdmissionStates.length,
  },
  duplicateFeatureIds: [...duplicateFeatureIds].sort(),
  blueprintOnly: blueprintOnly.sort(),
  unknownRegistry: unknownRegistry.sort(),
  malformedRecords: malformedRecords.map((r) => r.featureId ?? null),
  unresolvedRecords: unresolvedRecords.map((r) => r.featureId).sort(),
  invalidAdmissionStates: invalidAdmissionStates.map((r) => r.featureId).sort(),
};

console.log(JSON.stringify(report, null, 2));

if (report.status !== 'GREEN') process.exit(1);
