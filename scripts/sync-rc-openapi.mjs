import fs from 'node:fs';

const root = process.cwd();
const openapiPath = 'contracts/openapi/v1/openapi.yaml';
const inventoryPath = 'contracts/api/api-inventory.v1.json';
const consolidatedPolicyPath = 'contracts/openapi/v1/operation-policy.json';
const apiDir = 'contracts/api';

const readJson = (rel) => JSON.parse(fs.readFileSync(`${root}/${rel}`, 'utf8'));
const writeJson = (rel, value) => fs.writeFileSync(`${root}/${rel}`, `${JSON.stringify(value, null, 2)}\n`);

const normalizePath = (value) => {
  const path = String(value);
  if (path.startsWith('/v1/')) return path;
  if (path === '/v1') return path;
  return path.startsWith('/') ? `/v1${path}` : `/v1/${path}`;
};

const openapiPathFromCanonical = (canonicalPath) => {
  const normalized = normalizePath(canonicalPath);
  return normalized === '/v1' ? '/' : normalized.replace(/^\/v1/, '');
};

const operationKey = (method, path) => `${String(method).toUpperCase()} ${normalizePath(path)}`;

const tagToDomain = {
  Auth: 'auth_identity',
  Users: 'users_accounts',
  Contents: 'content',
  Media: 'media',
  Comments: 'interaction',
  Interactions: 'interaction',
  Feed: 'feed',
  Search: 'search_discovery',
  Notifications: 'notification',
  Creators: 'creator_ip_mcn',
  IPs: 'creator_ip_mcn',
  Organizations: 'creator_ip_mcn',
  Admin: 'audit_compliance',
};

function inferDomain(path, tags = []) {
  const p = normalizePath(path);
  if (p.startsWith('/v1/developer/')) return 'open_platform';
  if (p.startsWith('/v1/analytics/')) return 'analytics';
  if (p.startsWith('/v1/recommendation/') || p.startsWith('/v1/realtime/')) return 'recommendation_realtime';
  if (p.startsWith('/v1/memberships/') || p.startsWith('/v1/subscriptions') || p.startsWith('/v1/entitlements/') || p === '/v1/entitlements' || p.startsWith('/v1/plans') || p.startsWith('/v1/payments/')) return 'subscription_entitlement_payment';
  if (p.startsWith('/v1/audit/') || p.startsWith('/v1/account/data-')) return 'audit_compliance';
  if (p.startsWith('/v1/mcn/') || p.startsWith('/v1/ip/') || p.startsWith('/v1/creator/') || p.startsWith('/v1/organizations/')) return 'creator_ip_mcn';
  for (const tag of tags) if (tagToDomain[tag]) return tagToDomain[tag];
  if (p.startsWith('/v1/auth/')) return 'auth_identity';
  if (p.startsWith('/v1/users/') || p.startsWith('/v1/accounts/')) return 'users_accounts';
  if (p.startsWith('/v1/content') || p.startsWith('/v1/articles/') || p.startsWith('/v1/posts/') || p.startsWith('/v1/galleries/') || p.startsWith('/v1/contents/')) return 'content';
  if (p.startsWith('/v1/media/')) return 'media';
  if (p.startsWith('/v1/feed')) return 'feed';
  if (p.startsWith('/v1/search') || p.startsWith('/v1/discovery/')) return 'search_discovery';
  if (p.startsWith('/v1/notifications') || p.startsWith('/v1/notification-preferences')) return 'notification';
  if (p.startsWith('/v1/comments/') || p.startsWith('/v1/interactions/') || p.startsWith('/v1/social/')) return 'interaction';
  return 'content';
}

function pascal(segment) {
  const clean = String(segment).replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, ' ');
  return clean.split(/\s+/).filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('');
}

function generatedOperationId(method, path) {
  const parts = normalizePath(path).replace(/^\/v1\/?/, '').split('/').filter(Boolean).map(pascal);
  const base = `${String(method).toLowerCase()}${parts.join('') || 'Root'}`;
  return base.charAt(0).toLowerCase() + base.slice(1);
}

function pathParameterNames(path) {
  return [...normalizePath(path).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function loadDomainPolicies() {
  const result = [];
  for (const name of fs.readdirSync(`${root}/${apiDir}`).filter((n) => n.endsWith('-operation-policy.v1.json')).sort()) {
    const doc = readJson(`${apiDir}/${name}`);
    for (const operation of doc.operations ?? []) {
      if (!operation?.operationId || !operation?.method || !operation?.path) continue;
      result.push({ ...operation, __source: `${apiDir}/${name}` });
    }
  }
  return result;
}

function parseOpenApi(raw = fs.readFileSync(`${root}/${openapiPath}`, 'utf8')) {
  const lines = raw.split(/\r?\n/);
  const operations = [];
  let currentPath = null;
  let currentMethod = null;
  let currentOperationId = null;
  let currentTags = [];

  const flush = () => {
    if (currentPath && currentMethod && currentOperationId) {
      operations.push({
        operationId: currentOperationId,
        method: currentMethod,
        path: normalizePath(currentPath),
        openapiPath: currentPath,
        tags: currentTags,
        domain: inferDomain(currentPath, currentTags),
      });
    }
    currentOperationId = null;
    currentTags = [];
  };

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:#]+):\s*$/);
    if (pathMatch) {
      flush();
      currentPath = pathMatch[1].trim();
      currentMethod = null;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete|head|options|trace):\s*$/i);
    if (methodMatch && currentPath) {
      flush();
      currentMethod = methodMatch[1].toUpperCase();
      continue;
    }
    if (!currentPath || !currentMethod) continue;
    const operationMatch = line.match(/^\s+operationId:\s*([^#\s]+)\s*(?:#.*)?$/);
    if (operationMatch) currentOperationId = operationMatch[1].trim();
    const tagsMatch = line.match(/^\s+tags:\s*\[([^\]]*)\]\s*$/);
    if (tagsMatch) currentTags = tagsMatch[1].split(',').map((x) => x.trim()).filter(Boolean);
  }
  flush();
  return operations;
}

function buildOpenApiOperation({ operationId, method, canonicalPath, domain }) {
  const tagMap = {
    auth_identity: 'Auth',
    users_accounts: 'Users',
    content: 'Contents',
    media: 'Media',
    feed: 'Feed',
    interaction: 'Interactions',
    notification: 'Notifications',
    search_discovery: 'Search',
    creator_ip_mcn: 'Creators',
    subscription_entitlement_payment: 'Users',
    audit_compliance: 'Admin',
    analytics: 'Analytics',
    recommendation_realtime: 'Feed',
    open_platform: 'Developer',
  };
  const params = pathParameterNames(canonicalPath);
  const lines = [];
  lines.push(`    ${method.toLowerCase()}:`);
  lines.push(`      tags: [${tagMap[domain] ?? 'Contents'}]`);
  lines.push(`      summary: Discovery draft for ${method} ${canonicalPath}`);
  lines.push(`      operationId: ${operationId}`);
  lines.push('      x-luckread-contract-status: DISCOVERY_DRAFT');
  lines.push(`      x-luckread-source: ${inventoryPath}`);
  if (params.length) {
    lines.push('      parameters:');
    for (const name of params) {
      lines.push(`        - name: ${name}`);
      lines.push('          in: path');
      lines.push('          required: true');
      lines.push("          schema: { $ref: '#/components/schemas/ResourceId' }");
    }
  }
  lines.push('      responses:');
  lines.push('        default:');
  lines.push('          description: Discovery-only operation; detailed response contract remains to be closed.');
  return lines.join('\n');
}

function insertIntoExistingPath(raw, rawPath, methodBlocks) {
  const lines = raw.split('\n');
  const header = `  ${rawPath}:`;
  const start = lines.findIndex((line) => line === header);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  \/.*:\s*$/.test(lines[i]) || lines[i] === 'components:') { end = i; break; }
  }
  const before = lines.slice(0, end);
  const after = lines.slice(end);
  if (before.length && before[before.length - 1] !== '') before.push('');
  return [...before, ...methodBlocks.flatMap((b, i) => i ? ['', ...b.split('\n')] : b.split('\n')), ...after].join('\n');
}

function addOpenApiOperations(raw, missing) {
  if (!missing.length) return { raw, added: 0 };
  let next = raw;
  let added = 0;
  const existingPathNames = new Set([...next.matchAll(/^  (\/[^:#]+):\s*$/gm)].map((m) => m[1]));
  const existingOperations = parseOpenApi(next);
  const existingKeys = new Set(existingOperations.map((x) => operationKey(x.method, x.path)));
  const grouped = new Map();

  for (const op of missing) {
    const key = operationKey(op.method, op.path);
    if (existingKeys.has(key)) continue;
    const rawPath = openapiPathFromCanonical(op.path);
    if (!grouped.has(rawPath)) grouped.set(rawPath, []);
    grouped.get(rawPath).push(op);
  }

  const newPathBlocks = [];
  for (const [rawPath, ops] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    ops.sort((a, b) => a.method.localeCompare(b.method));
    const methodBlocks = ops.map((op) => buildOpenApiOperation(op));
    if (existingPathNames.has(rawPath)) {
      const changed = insertIntoExistingPath(next, rawPath, methodBlocks);
      if (changed !== null) {
        next = changed;
        added += ops.length;
        for (const op of ops) existingKeys.add(operationKey(op.method, op.path));
      }
    } else {
      newPathBlocks.push(`  ${rawPath}:\n${methodBlocks.join('\n\n')}`);
      added += ops.length;
    }
  }

  if (newPathBlocks.length) {
    const marker = '\ncomponents:\n';
    const index = next.indexOf(marker);
    if (index < 0) throw new Error('canonical OpenAPI components marker not found');
    next = `${next.slice(0, index)}\n${newPathBlocks.join('\n\n')}\n${next.slice(index)}`;
  }
  return { raw: next, added };
}

const inventory = readJson(inventoryPath);
const domainPolicies = loadDomainPolicies();
const openapiRaw = fs.readFileSync(`${root}/${openapiPath}`, 'utf8');
const openapiOperations = parseOpenApi(openapiRaw);

const inventoryRecords = [];
for (const [domain, group] of Object.entries(inventory.domains ?? {})) {
  for (const raw of group.endpoint_groups ?? []) {
    const match = String(raw).match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/v1\/\S+)$/);
    if (!match) continue;
    inventoryRecords.push({ method: match[1], path: match[2], domain });
  }
}

const inventoryMap = new Map(inventoryRecords.map((x) => [operationKey(x.method, x.path), x]));
const openapiMap = new Map(openapiOperations.map((x) => [operationKey(x.method, x.path), x]));

let addedToInventory = 0;
for (const op of openapiOperations.sort((a, b) => operationKey(a.method, a.path).localeCompare(operationKey(b.method, b.path)))) {
  const key = operationKey(op.method, op.path);
  if (inventoryMap.has(key)) continue;
  const domain = inferDomain(op.path, op.tags);
  if (!inventory.domains[domain]) inventory.domains[domain] = { required: true, endpoint_groups: [] };
  inventory.domains[domain].endpoint_groups.push(`${op.method} ${op.path}`);
  inventoryMap.set(key, { method: op.method, path: op.path, domain });
  addedToInventory += 1;
}
for (const group of Object.values(inventory.domains ?? {})) group.endpoint_groups = [...new Set(group.endpoint_groups)].sort();

const missingOpenApi = [];
for (const [key, record] of inventoryMap) {
  if (openapiMap.has(key)) continue;
  const separator = key.indexOf(' ');
  const method = key.slice(0, separator);
  const path = key.slice(separator + 1);
  const exactPolicy = domainPolicies.find((p) => operationKey(p.method, p.path) === key);
  const operationId = exactPolicy?.operationId ?? generatedOperationId(method, path);
  missingOpenApi.push({ operationId, method, path, domain: record.domain });
}

const { raw: openapiNext, added: addedToOpenApi } = addOpenApiOperations(openapiRaw, missingOpenApi);
if (openapiNext !== openapiRaw) fs.writeFileSync(`${root}/${openapiPath}`, openapiNext);

const effectiveOpenApi = parseOpenApi(openapiNext);
const effectiveByKey = new Map(effectiveOpenApi.map((x) => [operationKey(x.method, x.path), x]));

const existingPolicy = fs.existsSync(`${root}/${consolidatedPolicyPath}`) ? readJson(consolidatedPolicyPath) : { version: '1.0.0', operations: [] };
const existingPolicyById = new Map((existingPolicy.operations ?? []).map((x) => [x.operationId, x]));
const policyByMethodPath = new Map(domainPolicies.map((p) => [operationKey(p.method, p.path), p]));
const targetOperations = [...effectiveByKey.values()].sort((a, b) => operationKey(a.method, a.path).localeCompare(operationKey(b.method, b.path)));
const usedIds = new Set();
const consolidatedOperations = [];

for (const op of targetOperations) {
  const key = operationKey(op.method, op.path);
  const source = policyByMethodPath.get(key);
  const existing = existingPolicyById.get(op.operationId) ?? (source?.operationId ? existingPolicyById.get(source.operationId) : null);
  let operationId = op.operationId;
  while (usedIds.has(operationId)) operationId = `${operationId}Op`;
  usedIds.add(operationId);

  if (existing) {
    consolidatedOperations.push({ ...existing, operationId });
    continue;
  }

  const authorization = source?.authorization;
  const retry = source?.retry;
  const idempotency = source?.idempotency;
  const stateful = source?.stateMachine?.required === true || operationId === 'transitionAccountState' || operationId === 'transitionContentState';
  let stateMachine = 'none';
  if (operationId === 'transitionAccountState' || /account-state/i.test(op.path)) stateMachine = 'account';
  else if (stateful) stateMachine = 'content';

  const method = String(op.method).toUpperCase();
  const authMode = authorization?.required === false ? 'public' : stateMachine !== 'none' ? 'state-machine' : 'permission';
  const permissions = authorization?.permission ? [authorization.permission] : [];
  consolidatedOperations.push({
    operationId,
    auth: { mode: authMode },
    permissions,
    auditRequired: method !== 'GET' && method !== 'HEAD',
    optimisticLockRequired: retry?.requiresOptimisticConcurrency === true,
    idempotencyRequired: idempotency?.required === true,
    stateMachine,
    'x-luckread-contract-status': 'DISCOVERY_DRAFT',
    'x-luckread-source': source?.__source ?? inventoryPath,
  });
}

writeJson(inventoryPath, inventory);
writeJson(consolidatedPolicyPath, { ...existingPolicy, version: existingPolicy.version ?? '1.0.0', operations: consolidatedOperations });

console.log(JSON.stringify({
  status: 'SYNCHRONIZED_DRAFT',
  openapiOperations: effectiveOpenApi.length,
  inventoryOperations: inventoryMap.size,
  addedToInventory,
  addedToOpenApi,
  consolidatedPolicyOperations: consolidatedOperations.length,
  remainingInventoryWithoutOpenApi: inventoryMap.size - effectiveOpenApi.length,
}, null, 2));
