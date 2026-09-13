import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'contracts/authz/adversarial-cases.json');
const contractPath = path.join(root, 'docs/20-P0-SECURITY-ADVERSARIAL-VALIDATION-v1.0.md');

let failed = false;
const fail = (message) => { console.error(`SECURITY_ADVERSARIAL_FAIL: ${message}`); failed = true; };

if (!fs.existsSync(manifestPath)) fail('missing adversarial case manifest');
if (!fs.existsSync(contractPath)) fail('missing adversarial validation contract');

let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
catch (error) { fail(`invalid adversarial manifest: ${error.message}`); }

if (manifest) {
  if (manifest.version !== '1.0') fail('unsupported adversarial manifest version');
  if (manifest.executionRequired !== true) fail('executionRequired must remain true');
  if (!Array.isArray(manifest.cases) || manifest.cases.length < 20) fail('insufficient mandatory adversarial cases');

  const ids = new Set();
  for (const test of manifest.cases) {
    if (!test.id || ids.has(test.id)) fail(`invalid or duplicate case id: ${test.id}`);
    ids.add(test.id);
    if (!test.class) fail(`missing case class: ${test.id}`);
    if (!test.expected) fail(`missing expected result: ${test.id}`);
  }

  const requiredClasses = [
    'IDOR', 'PRIVILEGE_ESCALATION', 'MASS_ASSIGNMENT', 'CROSS_TENANT',
    'REVOCATION', 'CREDENTIAL_REVOCATION', 'PAYLOAD_BOUNDARY',
    'LOCAL_API_BYPASS', 'REVOCATION_RACE'
  ];
  for (const cls of requiredClasses) {
    if (!manifest.cases.some((test) => test.class === cls)) fail(`missing adversarial class: ${cls}`);
  }
}

// This gate deliberately does not claim runtime security.
// Runtime evidence is produced only by the future executable E2E harness.
const evidenceDir = path.join(root, 'artifacts/security-adversarial');
if (!fs.existsSync(evidenceDir)) {
  console.log('SECURITY_ADVERSARIAL_EXECUTION=NOT_YET_AVAILABLE');
  console.log('SECURITY_GREEN=BLOCKED');
}

if (failed) process.exitCode = 1;
else console.log('SECURITY_ADVERSARIAL_CONTRACT_GREEN');
