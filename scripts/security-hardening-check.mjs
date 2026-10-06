import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;
const fail = (message) => { console.error(`SECURITY_HARDENING_FAIL: ${message}`); failed = true; };

const required = [
  'docs/19-P0-SECURITY-HARDENING-CONTRACT-v1.0.md',
  'contracts/authz/authorization-decision.json',
  'contracts/authz/authorization-decision.schema.json',
  'contracts/authz/field-policy.json',
  'contracts/authz/revocation-policy.json'
];
for (const file of required) if (!fs.existsSync(path.join(root, file))) fail(`missing artifact: ${file}`);

function json(file) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (e) { fail(`invalid JSON ${file}: ${e.message}`); return null; }
}

const decision = json('contracts/authz/authorization-decision.json');
const schema = json('contracts/authz/authorization-decision.schema.json');
const revocation = json('contracts/authz/revocation-policy.json');
const fields = json('contracts/authz/field-policy.json');

if (decision) {
  const requiredDecisionFields = ['decision','subject','action','resource','checks','policyVersion'];
  const decisionRequired = new Set(decision.required ?? []);
  for (const key of requiredDecisionFields) if (!decisionRequired.has(key)) fail(`authorization decision contract missing required field: ${key}`);
  const checks = decision.properties?.checks;
  const requiredChecks = ['authentication','accountState','permission','scope','resource','policy'];
  if (!checks || typeof checks !== 'object') fail('authorization decision contract must define checks schema');
  const checksRequired = new Set(checks?.required ?? []);
  for (const key of requiredChecks) if (!checksRequired.has(key)) fail(`decision checks schema missing required field: ${key}`);
  if (checks?.type !== 'object') fail('authorization decision checks schema must be an object');
  const order = decision['x-resolution-order'] ?? [];
  if (order[0] !== 'ACCOUNT_SECURITY_DENY' || order[1] !== 'CREDENTIAL_DENY') fail('security deny precedence must start with account and credential deny');
  const invariants = decision['x-hard-invariants'] ?? [];
  const requiredInvariantFragments = [
    'role name alone can never produce ALLOW',
    'resource identifier alone can never produce ALLOW',
    'Authorization evaluation failure produces DENY',
    'Authorization cache cannot override authoritative account state or revocation'
  ];
  for (const fragment of requiredInvariantFragments) {
    if (!invariants.some((x) => String(x).includes(fragment))) fail(`missing hard invariant: ${fragment}`);
  }
}

if (schema) {
  const required = new Set(schema.required ?? []);
  for (const key of ['authenticated','account_state_allows','subject_type_allows','permission_allows','scope_allows','resource_allows','policy_allows','required_approval_allows','business_state_allows','credential_allows','decision']) {
    if (!required.has(key)) fail(`authorization decision schema missing required property: ${key}`);
  }
  if (schema.additionalProperties !== false) fail('authorization decision schema must reject unknown properties');
}

if (revocation) {
  const rule = revocation.properties?.cacheRule?.enum ?? [];
  const failMode = revocation.properties?.failMode?.enum ?? [];
  if (!rule.includes('VERSION_MATCH_REQUIRED')) fail('cache rule must require version match');
  if (!failMode.includes('FAIL_CLOSED')) fail('revocation policy must fail closed');
  const requiredVersions = ['authorizationVersion','credentialVersion','membershipVersion','entitlementVersion','delegationVersion'];
  const versions = revocation['x-luckread']?.versionDimensions ?? [];
  for (const version of requiredVersions) if (!versions.includes(version)) fail(`revocation version missing: ${version}`);
}

if (fields) {
  const protectedFields = fields['x-protected-fields']?.map((entry) => entry?.field).filter(Boolean) ?? fields.protected_fields ?? fields.server_owned_fields ?? [];
  for (const field of ['role','status','verified','owner_id','organization_id','scope_id','entitlements','subscription_state','payment_state','moderation_state','security_state']) {
    if (!protectedFields.includes(field)) fail(`protected field missing: ${field}`);
  }
}

const adminBootstrapScript = 'scripts/admin-account-bootstrap.mjs'
const adminBootstrapWorkflow = '.github/workflows/admin-account-bootstrap.yml'
if (fs.existsSync(path.join(root, adminBootstrapScript))) {
  const source = fs.readFileSync(path.join(root, adminBootstrapScript), 'utf8')
  for (const forbidden of ['LUCKREAD_ADMIN_BOOTSTRAP_PASSWORD', 'password', 'hash', 'salt', 'UPDATE users', 'collection: \'users\'']) {
    if (source.toLowerCase().includes(forbidden.toLowerCase())) {
      fail(`admin bootstrap must not contain legacy Payload credential material or password writes: ${forbidden}`)
    }
  }
  if (!source.includes('BETTER_AUTH_USER_ID')) fail('admin bootstrap must require BETTER_AUTH_USER_ID')
  if (!source.includes('INSERT INTO role_assignments')) fail('admin bootstrap must remain role-binding only')
}

if (fs.existsSync(path.join(root, adminBootstrapWorkflow))) {
  const source = fs.readFileSync(path.join(root, adminBootstrapWorkflow), 'utf8')
  for (const forbidden of ['Apply account username/password', 'Prepare native Payload password material', 'hash=', 'salt=', 'UPDATE users SET']) {
    if (source.toLowerCase().includes(forbidden.toLowerCase())) {
      fail(`admin bootstrap workflow must not write legacy Payload credentials: ${forbidden}`)
    }
  }
  if (!source.includes('BETTER_AUTH_USER_ID')) fail('admin bootstrap workflow must resolve Better Auth identity before role binding')
  if (!source.includes("provider_id='credential'")) fail("admin bootstrap workflow must verify the Better Auth credential account")
}

const w01AuthRoot = path.join(root, 'workers/W01-payload/src/app/auth')
function walkW01Auth(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'password') continue
      walkW01Auth(full)
      continue
    }
    if (!/\.(mjs|cjs|js|ts|tsx)$/.test(entry.name)) continue
    const source = fs.readFileSync(full, 'utf8')
    for (const [name, re] of [
      ['Payload native auth call', /payload\\.(auth|login)\\s*\\(/],
      ['Payload runtime auth import', /from ['"]payload['"]/],
      ['Payload runtime loader in auth path', /getPayload\\s*\\(\\s*\\{\\s*config/],
    ]) {
      if (re.test(source)) fail(`W01 normal auth path must not use Payload authentication: ${name}: ${full}`)
    }
  }
}
walkW01Auth(w01AuthRoot)

const roots = ['src','app','server','workers','packages','collections','payload','lib','routes'];
const patterns = [
  { name: 'direct admin bypass', re: /(?:user|subject)\.role\s*(?:===|==)\s*['"](?:admin|super_admin)['"]/g },
  { name: 'request body mass assignment', re: /(?:Object\.assign|\.update|\.create)\s*\([^\n]*(?:request\.(body|json)|req\.(body|json))/g },
  { name: 'client protected role assignment', re: /(?:role|status|verified|organization_id|owner_id|scope_id)\s*:\s*(?:body|req\.body|request\.body)/g }
];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','.next','dist','build'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(mjs|cjs|js|ts|tsx)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      for (const {name,re} of patterns) { if (re.test(text)) fail(`${name}: ${full}`); re.lastIndex = 0; }
    }
  }
}
for (const dir of roots) walk(path.join(root, dir));

if (failed) process.exitCode = 1;
else console.log('SECURITY_HARDENING_STATIC_GREEN');
