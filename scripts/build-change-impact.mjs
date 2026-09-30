import fs from 'node:fs';

const root = process.cwd();
const featurePath = 'contracts/alignment/feature-inventory.v1.json';
const mappingPath = 'contracts/alignment/cross-system-mapping.v1.json';
const reconciliationPath = 'contracts/alignment/five-way-reconciliation.v1.json';
const outPath = 'contracts/alignment/change-impact.v1.json';
const fail = (m) => { console.error(`CHANGE_IMPACT_BLOCKED: ${m}`); process.exit(1); };
const read = (p) => JSON.parse(fs.readFileSync(`${root}/${p}`, 'utf8'));
for (const p of [featurePath, mappingPath, reconciliationPath]) if (!fs.existsSync(`${root}/${p}`)) fail(`missing ${p}`);
const features = read(featurePath).features ?? [];
const mappings = read(mappingPath).records ?? [];
const reconciliation = read(reconciliationPath).records ?? [];
const mappingByFeature = new Map();
for (const r of mappings) {
  if (!r.featureId) continue;
  const list = mappingByFeature.get(r.featureId) ?? [];
  list.push(r);
  mappingByFeature.set(r.featureId, list);
}
const reconciliationByFeature = new Map();
for (const r of reconciliation) {
  if (!r.featureId) continue;
  const list = reconciliationByFeature.get(r.featureId) ?? [];
  list.push(r);
  reconciliationByFeature.set(r.featureId, list);
}
const records = features.map((f) => {
  const ms = mappingByFeature.get(f.featureId) ?? [];
  const rs = reconciliationByFeature.get(f.featureId) ?? [];
  const affectedSystems = new Set();
  const affectedRefs = [];
  const evidenceRefs = [f.sourceRef];
  for (const m of ms) {
    for (const s of ['DB','API','PAYLOAD','CODE','TEST','MIGRATION','EVENT','AUTHORIZATION']) {
      if ((m.affectedSystems ?? []).includes(s)) affectedSystems.add(s);
    }
    for (const x of [...(m.entityIds ?? []), ...(m.apiOperationIds ?? []), ...(m.payloadCollections ?? []), ...(m.codeEvidenceRefs ?? [])]) affectedRefs.push(x);
    evidenceRefs.push(...(m.evidence ?? []));
  }
  for (const r of rs) {
    for (const s of ['DB','API','PAYLOAD','CODE','TEST','MIGRATION','EVENT','AUTHORIZATION']) if ((r.affectedSystems ?? []).includes(s)) affectedSystems.add(s);
    evidenceRefs.push(...(r.evidenceRefs ?? []));
  }
  let status = 'UNRESOLVED';
  if (ms.length === 0) status = 'BLOCKED';
  else if (rs.some((r) => ['DRIFT','CONFLICT','DUPLICATE','UNRESOLVED','BLOCKED','MISSING','EXTRA'].includes(r.status))) status = 'MODIFIED';
  else if (ms.some((m) => m.status === 'MISSING')) status = 'MODIFIED';
  else status = 'UNCHANGED';
  return { impactId:`IMPACT:${f.featureId}`, featureId:f.featureId, status, affectedSystems:[...affectedSystems].sort(), affectedRefs:[...new Set(affectedRefs)].sort(), evidenceRefs:[...new Set(evidenceRefs)].sort(), blockers: ms.length === 0 ? ['No cross-system mapping exists for feature; impact cannot be inferred.'] : [] };
});
const blocked = records.some((r) => r.status === 'BLOCKED' || r.status === 'UNRESOLVED');
const output = { version:'1.0.0', status:blocked ? 'NOT_GREEN' : 'GREEN', sourceOfTruth:`${featurePath} + ${mappingPath} + ${reconciliationPath}`, generatedBy:'scripts/build-change-impact.mjs', records };
fs.mkdirSync(`${root}/contracts/alignment`, {recursive:true});
fs.writeFileSync(`${root}/${outPath}`, `${JSON.stringify(output,null,2)}\n`);
console.log(`Change impact inventory: ${records.length} features; status=${output.status}`);
