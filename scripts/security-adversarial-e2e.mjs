import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const casesPath = path.join(root, 'contracts/authz/adversarial-cases.json');
const adapterContractPath = path.join(root, 'contracts/authz/security-e2e-adapter.json');
const adapterPath = process.env.SECURITY_E2E_ADAPTER;
const evidencePath = process.env.SECURITY_EVIDENCE_PATH || path.join(root, 'artifacts/security-adversarial/evidence.json');

function fail(message) {
  console.error(`SECURITY_ADVERSARIAL_E2E=FAIL`);
  console.error(message);
  process.exit(1);
}

function loadJson(file) {
  if (!fs.existsSync(file)) fail(`missing required file: ${file}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`invalid JSON: ${file}: ${error.message}`); }
}

const registry = loadJson(casesPath);
const adapterContract = loadJson(adapterContractPath);

if (registry.executionRequired !== true) fail('adversarial registry must require execution');
if (adapterContract.status !== 'CONTRACT_ONLY') {
  fail('adapter contract status must remain CONTRACT_ONLY until a real implementation adapter is reviewed');
}

if (!adapterPath) {
  console.error('SECURITY_E2E_EXECUTION=BLOCKED');
  console.error('SECURITY_GREEN=BLOCKED');
  console.error('Reason: SECURITY_E2E_ADAPTER is not configured. No runtime security claim is permitted.');
  process.exit(0);
}

if (!fs.existsSync(adapterPath)) fail(`configured SECURITY_E2E_ADAPTER does not exist: ${adapterPath}`);

let adapter;
try {
  adapter = await import(path.resolve(adapterPath));
} catch (error) {
  fail(`unable to load security E2E adapter: ${error.message}`);
}

if (typeof adapter.executeCase !== 'function') fail('adapter must export executeCase(caseDefinition, context)');
if (typeof adapter.getContext !== 'function') fail('adapter must export getContext()');

const context = await adapter.getContext();
if (!context || typeof context !== 'object') fail('adapter.getContext() must return an object');

const results = [];
for (const testCase of registry.cases) {
  const result = await adapter.executeCase(testCase, context);
  if (!result || typeof result !== 'object') fail(`${testCase.id}: adapter returned invalid result`);
  results.push({
    case_id: testCase.id,
    expected: testCase.expected,
    actual: result.actual,
    result: result.result,
    request_id: result.request_id,
    trace_id: result.trace_id,
    timestamp: result.timestamp,
    authorization_version: result.authorization_version,
    subject: result.subject,
    action: result.action,
    resource: result.resource
  });
}

const failures = results.filter((item) => item.result !== 'PASS' || item.actual !== item.expected);
const missingEvidence = results.filter((item) => !item.request_id || !item.trace_id || !item.timestamp);

if (failures.length || missingEvidence.length) {
  console.error(`SECURITY_E2E_EXECUTION=FAIL`);
  console.error(`failed_cases=${failures.length}`);
  console.error(`missing_evidence=${missingEvidence.length}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify({
  version: '1.0',
  test_run_id: context.test_run_id,
  commit_sha: context.commit_sha,
  contract_sha: context.contract_sha,
  policy_version: context.policy_version,
  cases: results
}, null, 2) + '\n');

console.log(`SECURITY_E2E_EXECUTION=PASS`);
console.log(`SECURITY_EVIDENCE=${evidencePath}`);
console.log(`SECURITY_GREEN=CANDIDATE`);
