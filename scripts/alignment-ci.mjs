import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const run = (script) => {
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const required = [
  ['feature', 'scripts/build-feature-inventory.mjs'],
  ['api', 'scripts/build-api-alignment-inventory.mjs'],
  ['payload', 'scripts/build-payload-alignment-inventory.mjs'],
  ['code', 'scripts/build-code-evidence-inventory.mjs'],
  ['five-way', 'scripts/build-five-way-reconciliation.mjs'],
  ['impact', 'scripts/build-change-impact.mjs'],
];
for (const [, script] of required) {
  if (!fs.existsSync(`${root}/${script}`)) {
    console.error(`ALIGNMENT_CI_BLOCKED: missing ${script}`);
    process.exit(1);
  }
}

// Cross-system mapping and DB/entity/persistence inventory are authoritative
// inputs to the five-way graph. CI must fail closed instead of manufacturing
// mappings when either source is absent.
const authoritativeInputs = [
  'contracts/alignment/database-entity-persistence-inventory.v1.json',
  'contracts/alignment/cross-system-mapping.v1.json',
];
for (const p of authoritativeInputs) {
  if (!fs.existsSync(`${root}/${p}`)) {
    console.error(`ALIGNMENT_CI_BLOCKED: missing authoritative input ${p}`);
    process.exit(1);
  }
}

// Regenerate all derived inventories before reconciliation so stale committed
// outputs cannot be accepted by the admission gate.
for (const [, script] of required.slice(0, 4)) run(script);
run('scripts/build-five-way-reconciliation.mjs');
run('scripts/build-change-impact.mjs');

const reconciliation = 'contracts/alignment/five-way-reconciliation.v1.json';
const impact = 'contracts/alignment/change-impact.v1.json';
for (const p of [reconciliation, impact]) if (!fs.existsSync(`${root}/${p}`)) {
  console.error(`ALIGNMENT_CI_BLOCKED: missing generated ${p}`);
  process.exit(1);
}
const recon = JSON.parse(fs.readFileSync(`${root}/${reconciliation}`, 'utf8'));
const impactDoc = JSON.parse(fs.readFileSync(`${root}/${impact}`, 'utf8'));
const bad = new Set(['MISSING','EXTRA','DRIFT','CONFLICT','DUPLICATE','UNRESOLVED','BLOCKED']);
const reconBad = (recon.records ?? []).filter((r) => bad.has(r.status));
const impactBad = (impactDoc.records ?? []).filter((r) => ['BLOCKED','UNRESOLVED'].includes(r.status));
if (recon.status !== 'GREEN' || impactDoc.status !== 'GREEN' || reconBad.length || impactBad.length) {
  console.error(`ALIGNMENT_CI_NOT_GREEN: reconciliation=${recon.status}; impact=${impactDoc.status}; reconciliationBlockers=${reconBad.length}; impactBlockers=${impactBad.length}`);
  process.exit(1);
}
console.log('ALIGNMENT_CI_GREEN');
