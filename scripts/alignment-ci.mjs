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
  ['impact', 'scripts/build-change-impact.mjs'],
];
for (const [, script] of required) {
  if (!fs.existsSync(`${root}/${script}`)) {
    console.error(`ALIGNMENT_CI_BLOCKED: missing ${script}`);
    process.exit(1);
  }
}
for (const [, script] of required) run(script);
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
