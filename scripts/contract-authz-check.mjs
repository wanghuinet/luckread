import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;
const fail = (message) => { console.error(`AUTHZ_CONTRACT_FAIL: ${message}`); failed = true; };

const required = [
  'contracts/authz/authorization-decision.json',
  'contracts/authz/authorization-decision.schema.json',
  'contracts/authz/subject-types.json',
  'contracts/authz/field-policy.json',
  'contracts/authz/revocation-policy.json',
  'docs/12-P0-AUTHORIZATION-HARDENING-CONTRACT-v1.0.md',
  'docs/13-P0-AUTHORIZATION-E2E-MATRIX-v1.0.md',
  'docs/14-P0-AUTHORIZATION-CONTRACT-RECONCILIATION-v1.0.md',
  'docs/19-P0-SECURITY-HARDENING-CONTRACT-v1.0.md'
];
for (const file of required) if (!fs.existsSync(path.join(root, file))) fail(`missing required artifact: ${file}`);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { fail(`invalid JSON: ${file}: ${error.message}`); return null; }
}

const decision = readJson('contracts/authz/authorization-decision.json');
const schema = readJson('contracts/authz/authorization-decision.schema.json');
const subjects = readJson('contracts/authz/subject-types.json');
const fields = readJson('contracts/authz/field-policy.json');
const revocation = readJson('contracts/authz/revocation-policy.json');

if (decision) {
  const checks = decision.checks;
  for (const key of ['authentication','accountState','permission','scope','resource','policy']) {
    if (!checks || !Object.hasOwn(checks, key)) fail(`missing decision check: ${key}`);
  }
  const order = decision['x-resolution-order'] ?? [];
  if (order[0] !== 'ACCOUNT_SECURITY_DENY' || order[1] !== 'CREDENTIAL_DENY') fail('security deny precedence must be account/credential first');
  const invariants = decision['x-hard-invariants'] ?? [];
  for (const fragment of [
    'role name alone can never produce ALLOW',
    'resource identifier alone can never produce ALLOW',
    'Authorization evaluation failure produces DENY',
    'Authorization cache cannot override authoritative account state or revocation'
  ]) if (!invariants.some((x) => String(x).includes(fragment))) fail(`missing hard invariant: ${fragment}`);
}

if (schema) {
  const requiredSchema = new Set(schema.required ?? []);
  for (const key of ['authenticated','account_state_allows','subject_type_allows','permission_allows','scope_allows','resource_allows','policy_allows','required_approval_allows','business_state_allows','credential_allows','decision']) {
    if (!requiredSchema.has(key)) fail(`schema missing required property: ${key}`);
  }
  if (schema.additionalProperties !== false) fail('authorization schema must reject unknown properties');
}

if (subjects) {
  const names = JSON.stringify(subjects);
  for (const expected of ['ANONYMOUS','USER','SERVICE','API_CLIENT','AUTOMATION']) if (!names.includes(expected)) fail(`subject type missing: ${expected}`);
}

if (fields) {
  const protectedFields = fields.protected_fields ?? fields.server_owned_fields ?? [];
  for (const field of ['role','status','verified','owner_id','organization_id','scope_id','entitlements','subscription_state','payment_state','moderation_state','security_state']) {
    if (!protectedFields.includes(field)) fail(`protected field missing: ${field}`);
  }
}

if (revocation) {
  if (!(revocation.properties?.cacheRule?.enum ?? []).includes('VERSION_MATCH_REQUIRED')) fail('revocation cache rule missing VERSION_MATCH_REQUIRED');
  if (!(revocation.properties?.failMode?.enum ?? []).includes('FAIL_CLOSED')) fail('revocation fail mode missing FAIL_CLOSED');
  for (const version of ['authorizationVersion','credentialVersion','membershipVersion','entitlementVersion','delegationVersion']) {
    if (!(revocation['x-luckread']?.versionDimensions ?? []).includes(version)) fail(`revocation version missing: ${version}`);
  }
}

const roots = ['src','app','server','workers','packages','collections','payload','lib','routes'];
const suspicious = [
  /(?:user|subject)\.role\s*(?:===|==)\s*['"](?:admin|super_admin)['"]/g,
  /Object\.assign\s*\([^\n]*(?:request\.(body|json)|req\.(body|json))/g,
  /(?:role|status|verified|organization_id|owner_id|scope_id)\s*:\s*(?:body|req\.body|request\.body)/g
];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','.next','dist','build'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(mjs|cjs|js|ts|tsx)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      for (const pattern of suspicious) { if (pattern.test(text)) fail(`suspicious authorization bypass pattern in ${full}`); pattern.lastIndex = 0; }
    }
  }
}
for (const dir of roots) walk(path.join(root, dir));

if (!failed) console.log('AUTHZ_CONTRACT_GREEN');
else process.exitCode = 1;
