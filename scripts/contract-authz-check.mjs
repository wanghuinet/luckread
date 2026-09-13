import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'contracts/authz/authorization-decision.json',
  'contracts/authz/authorization-decision.schema.json',
  'contracts/authz/subject-types.json',
  'contracts/authz/field-policy.json',
  'docs/12-P0-AUTHORIZATION-HARDENING-CONTRACT-v1.0.md',
  'docs/13-P0-AUTHORIZATION-E2E-MATRIX-v1.0.md',
  'docs/14-P0-AUTHORIZATION-CONTRACT-RECONCILIATION-v1.0.md'
];

const fail = (message) => {
  console.error(`AUTHZ_CONTRACT_FAIL: ${message}`);
  process.exitCode = 1;
};

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing required artifact: ${file}`);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { fail(`invalid JSON: ${file}: ${error.message}`); return null; }
}

const decision = readJson('contracts/authz/authorization-decision.json');
const schema = readJson('contracts/authz/authorization-decision.schema.json');
const subjects = readJson('contracts/authz/subject-types.json');
const fields = readJson('contracts/authz/field-policy.json');

if (decision) {
  const checks = decision.mandatory_checks ?? decision.checks;
  if (!Array.isArray(checks)) fail('authorization decision contract must declare mandatory checks');
  const requiredChecks = [
    'authenticated','account_state_allows','subject_type_allows','permission_allows',
    'scope_allows','resource_allows','policy_allows','required_approval_allows',
    'business_state_allows','credential_allows'
  ];
  for (const check of requiredChecks) {
    if (!checks.includes(check)) fail(`missing mandatory authorization check: ${check}`);
  }
  if (decision.deny_precedence !== 'ANY_REQUIRED_CHECK_FALSE') fail('deny precedence must be fail-closed');
}

if (schema) {
  const required = new Set(schema.required ?? []);
  for (const key of ['authenticated','account_state_allows','permission_allows','scope_allows','resource_allows','decision']) {
    if (!required.has(key)) fail(`schema missing required property: ${key}`);
  }
}

if (subjects) {
  const names = JSON.stringify(subjects);
  for (const expected of ['ANONYMOUS','USER','SERVICE','API_CLIENT','AUTOMATION']) {
    if (!names.includes(expected)) fail(`subject type missing: ${expected}`);
  }
}

if (fields) {
  const protectedFields = fields.protected_fields ?? fields.server_owned_fields ?? [];
  for (const field of ['role','status','verified','owner_id','organization_id','scope_id']) {
    if (!protectedFields.includes(field)) fail(`protected field missing: ${field}`);
  }
}

const sourceRoots = ['src', 'app', 'server', 'workers', 'packages'];
const suspicious = [
  /role\\s*===\\s*['\"]admin['\"]/g,
  /role\\s*==\\s*['\"]admin['\"]/g,
  /role\\s*==\\s*['\"]super_admin['\"]/g,
  /Object\\.assign\\s*\\([^)]*request\\.(body|json)/g
];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(mjs|cjs|js|ts|tsx)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      for (const pattern of suspicious) {
        if (pattern.test(text)) fail(`suspicious authorization bypass pattern in ${full}`);
        pattern.lastIndex = 0;
      }
    }
  }
}

for (const rootDir of sourceRoots) walk(path.join(root, rootDir));

if (!process.exitCode) console.log('AUTHZ_CONTRACT_GREEN');
