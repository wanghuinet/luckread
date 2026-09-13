import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const casesPath = path.join(root, 'contracts/authz/adversarial-cases.json');
const evidencePath = path.join(root, 'artifacts/security/adversarial-evidence.json');

const fail = (message) => {
  console.error(`SECURITY_EVIDENCE_FAIL: ${message}`);
  process.exitCode = 1;
};

if (!fs.existsSync(casesPath)) {
  fail('missing adversarial case registry');
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
if (registry.executionRequired !== true) fail('adversarial execution must be required');
if (!Array.isArray(registry.cases) || registry.cases.length === 0) fail('no adversarial cases registered');

if (!fs.existsSync(evidencePath)) {
  console.error('SECURITY_ADVERSARIAL_EXECUTION=NOT_YET_AVAILABLE');
  console.error('SECURITY_GREEN=BLOCKED');
  process.exit(0);
}

let evidence;
try {
  evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
} catch (error) {
  fail(`invalid evidence JSON: ${error.message}`);
  process.exit(1);
}

if (evidence.execution_status !== 'EXECUTED') fail('execution_status must be EXECUTED');
if (!evidence.commit_sha) fail('missing commit_sha');
if (!evidence.contract_sha) fail('missing contract_sha');
if (!evidence.test_run_id) fail('missing test_run_id');
if (!Array.isArray(evidence.results)) fail('results must be an array');

const expectedIds = new Set(registry.cases.map((item) => item.id));
const seen = new Set();
for (const result of evidence.results) {
  if (!result.case_id || !expectedIds.has(result.case_id)) fail(`unknown or missing case_id: ${result.case_id}`);
  if (seen.has(result.case_id)) fail(`duplicate evidence case: ${result.case_id}`);
  seen.add(result.case_id);
  for (const key of ['expected', 'actual', 'result', 'request_id', 'trace_id', 'policy_version']) {
    if (result[key] === undefined || result[key] === null || result[key] === '') fail(`missing ${key} for ${result.case_id}`);
  }
  if (result.result !== 'PASS') fail(`case is not PASS: ${result.case_id}`);
}

for (const id of expectedIds) {
  if (!seen.has(id)) fail(`missing execution evidence: ${id}`);
}

if (!process.exitCode) {
  console.log(`SECURITY_ADVERSARIAL_EXECUTION=GREEN (${seen.size}/${expectedIds.size})`);
  console.log('SECURITY_GREEN=ELIGIBLE_FOR_FINAL_GATE');
}
