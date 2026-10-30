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

function buildCommerceOpenApiOperation({ operationId, method }) {
  const security = [
    '      security:',
    '        - sessionCookieAuth: []',
    '        - bearerAuth: []',
  ];
  const listParameters = [
    '      parameters:',
    '        - name: limit',
    '          in: query',
    '          required: false',
    '          schema: { type: integer, minimum: 1, maximum: 50, default: 20 }',
    '        - name: cursor',
    '          in: query',
    '          required: false',
    '          schema: { type: string, minLength: 1, maxLength: 512 }',
  ];
  const envelope = (item) => ({
    type: 'object',
    additionalProperties: false,
    required: ['data', 'requestId'],
    properties: {
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'nextCursor', 'hasMore'],
        properties: {
          items: { type: 'array', maxItems: 50, items: item },
          nextCursor: { type: ['string', 'null'], maxLength: 512 },
          hasMore: { type: 'boolean' },
        },
      },
      requestId: { type: 'string', pattern: '^req_[A-Za-z0-9_-]{1,123}$' },
    },
  });
  const itemSchemas = {
    getPaymentsHistory: {
      type: 'object', additionalProperties: false,
      required: ['paymentId', 'orderId', 'amountMinor', 'currency', 'status', 'version', 'providerUpdatedAt', 'createdAt', 'updatedAt', 'refundedMinor'],
      properties: {
        paymentId: { type: 'string', pattern: '^pay_[A-Za-z0-9]{26}$' },
        orderId: { type: 'string', pattern: '^ord_[A-Za-z0-9_-]{1,90}$' },
        amountMinor: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        status: { type: 'string', maxLength: 64 },
        version: { type: 'integer', minimum: 1 },
        providerUpdatedAt: { type: ['string', 'null'], format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        refundedMinor: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
      },
    },
    getPaymentsRefunds: {
      type: 'object', additionalProperties: false,
      required: ['refundId', 'paymentId', 'orderId', 'amountMinor', 'currency', 'status', 'reason', 'version', 'providerUpdatedAt', 'createdAt', 'updatedAt'],
      properties: {
        refundId: { type: 'string', pattern: '^ref_[A-Za-z0-9]{26}$' },
        paymentId: { type: 'string', pattern: '^pay_[A-Za-z0-9]{26}$' },
        orderId: { type: 'string', pattern: '^ord_[A-Za-z0-9_-]{1,90}$' },
        amountMinor: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        status: { type: 'string', enum: ['REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REVIEW', 'RECONCILIATION_REQUIRED'] },
        reason: { type: ['string', 'null'], maxLength: 255 },
        version: { type: 'integer', minimum: 1 },
        providerUpdatedAt: { type: ['string', 'null'], format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    getBillingDocuments: {
      type: 'object', additionalProperties: false,
      required: ['documentId', 'documentType', 'documentNumber', 'orderId', 'paymentId', 'amountMinor', 'currency', 'snapshot', 'issuedAt', 'createdAt'],
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 128 },
        documentType: { type: 'string', enum: ['INVOICE', 'RECEIPT'] },
        documentNumber: { type: 'string', minLength: 1, maxLength: 128 },
        orderId: { type: 'string', pattern: '^ord_[A-Za-z0-9_-]{1,90}$' },
        paymentId: { type: ['string', 'null'], pattern: '^pay_[A-Za-z0-9]{26}$' },
        amountMinor: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        snapshot: { type: 'object', additionalProperties: true },
        issuedAt: { type: 'string', format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  };
  const methods = {
    getPaymentsHistory: 'List the authenticated customer payment history',
    getPaymentsRefunds: 'List the authenticated customer refund history',
    getBillingDocuments: 'List the authenticated customer invoices and receipts',
  };
  if (operationId === 'postPaymentsRefunds' && method === 'POST') {
    const requestSchema = {
      type: 'object', additionalProperties: false,
      required: ['paymentId', 'amountMinor', 'currency'],
      properties: {
        paymentId: { type: 'string', pattern: '^pay_[A-Za-z0-9]{26}$' },
        amountMinor: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        reason: { type: 'string', maxLength: 255 },
      },
    };
    const responseSchema = {
      type: 'object', additionalProperties: false,
      required: ['data', 'requestId'],
      properties: {
        data: {
          type: 'object', additionalProperties: false,
          required: ['refundId', 'paymentId', 'orderId', 'amountMinor', 'capturedAmountMinor', 'currency', 'status', 'reason', 'version', 'providerUpdatedAt', 'createdAt', 'updatedAt', 'replayed'],
          properties: {
            refundId: { type: 'string', pattern: '^ref_[A-Za-z0-9]{26}$' },
            paymentId: { type: 'string', pattern: '^pay_[A-Za-z0-9]{26}$' },
            orderId: { type: 'string', pattern: '^ord_[A-Za-z0-9_-]{1,90}$' },
            amountMinor: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
            capturedAmountMinor: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
            currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            status: { type: 'string', enum: ['REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REVIEW', 'RECONCILIATION_REQUIRED'] },
            reason: { type: ['string', 'null'], maxLength: 255 },
            version: { type: 'integer', minimum: 1 },
            providerUpdatedAt: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            replayed: { type: 'boolean' },
          },
        },
        requestId: { type: 'string', pattern: '^req_[A-Za-z0-9_-]{1,123}$' },
      },
    };
    return [
      '    post:',
      '      tags: [Commerce]',
      '      summary: Create a full or partial refund for an owned payment',
      '      description: W01 authorizes the own-Payment permission. W07 verifies D1-04 ownership and Hyperswitch amount_received, reserves a stable refund ID, and waits for a signed webhook to confirm the final refund state.',
      '      operationId: postPaymentsRefunds',
      '      x-luckread-contract-status: CONTRACTED_PARTIAL',
      '      x-luckread-runtime-status: IMPLEMENTED_SOURCE_ONLY_PENDING_D1_04_MIGRATION_AND_SECRETS',
      '      x-luckread-source: contracts/api/commerce-operation-policy.v1.json',
      ...security,
      '      parameters:',
      "        - $ref: '#/components/parameters/IdempotencyKeyRequired'",
      '      requestBody:',
      '        required: true',
      '        content:',
      '          application/json:',
      '            schema: ' + JSON.stringify(requestSchema),
      '      responses:',
      '        202:',
      '          description: Refund submitted or awaiting signed provider confirmation.',
      '          content:',
      '            application/json:',
      '              schema: ' + JSON.stringify(responseSchema),
      '        200:',
      '          description: Idempotent replay of a finalized refund.',
      '          content:',
      '            application/json:',
      '              schema: ' + JSON.stringify(responseSchema),
      "        '400': { $ref: '#/components/responses/ValidationFailed' }",
      "        '401': { $ref: '#/components/responses/Unauthenticated' }",
      "        '403': { $ref: '#/components/responses/PermissionDenied' }",
      "        '404': { $ref: '#/components/responses/NotFound' }",
      "        '409': { $ref: '#/components/responses/InvalidState' }",
      "        '428': { $ref: '#/components/responses/PreconditionRequired' }",
      "        '429': { $ref: '#/components/responses/RateLimited' }",
      "        '503': { $ref: '#/components/responses/ServiceUnavailable' }",
    ].join('\n');
  }
  if (method === 'GET' && Object.prototype.hasOwnProperty.call(itemSchemas, operationId)) {
    return [
      '    get:',
      '      tags: [Commerce]',
      "      summary: " + methods[operationId],
      '      operationId: ' + operationId,
      '      x-luckread-contract-status: CONTRACTED_PARTIAL',
      '      x-luckread-runtime-status: IMPLEMENTED_SOURCE_ONLY_PENDING_D1_04_MIGRATION',
      '      x-luckread-source: contracts/api/commerce-operation-policy.v1.json',
      ...security,
      ...listParameters,
      '      responses:',
      '        200:',
      '          description: Customer-owned records returned using bounded keyset pagination.',
      '          headers:',
      '            Cache-Control:',
      '              schema: { type: string, const: no-store }',
      '          content:',
      '            application/json:',
      '              schema: ' + JSON.stringify(envelope(itemSchemas[operationId])),
      "        '400': { $ref: '#/components/responses/ValidationFailed' }",
      "        '401': { $ref: '#/components/responses/Unauthenticated' }",
      "        '403': { $ref: '#/components/responses/PermissionDenied' }",
      "        '429': { $ref: '#/components/responses/RateLimited' }",
      "        '503': { $ref: '#/components/responses/ServiceUnavailable' }",
    ].join('\n');
  }
  return null;
}

function replaceExistingOpenApiOperation(raw, rawPath, method, methodBlock) {
  const lines = raw.split('\n');
  const pathHeader = '  ' + rawPath + ':';
  const pathStart = lines.findIndex((line) => line === pathHeader);
  if (pathStart < 0) return null;
  const pathEnd = lines.findIndex((line, index) => index > pathStart && ((line.startsWith('  /') && line.endsWith(':')) || line === 'components:'));
  const effectivePathEnd = pathEnd < 0 ? lines.length : pathEnd;
  const methodHeader = '    ' + String(method).toLowerCase() + ':';
  const methodStart = lines.findIndex((line, index) => index > pathStart && index < effectivePathEnd && line === methodHeader);
  if (methodStart < 0) return null;
  const methodHeaders = new Set(['    get:', '    post:', '    put:', '    patch:', '    delete:', '    head:', '    options:', '    trace:']);
  let methodEnd = effectivePathEnd;
  for (let index = methodStart + 1; index < effectivePathEnd; index += 1) {
    if (methodHeaders.has(lines[index])) { methodEnd = index; break; }
  }
  return [...lines.slice(0, methodStart), ...methodBlock.split('\n'), ...lines.slice(methodEnd)].join('\n');
}

function insertIntoExistingPath(raw, rawPath, methodBlocks) {
  let next = raw;
  for (const methodBlock of methodBlocks) {
    const lines = next.split('\n');
    const pathHeader = '  ' + rawPath + ':';
    const pathStart = lines.findIndex((line) => line === pathHeader);
    if (pathStart < 0) return null;
    let pathEnd = lines.length;
    for (let index = pathStart + 1; index < lines.length; index += 1) {
      if ((lines[index].startsWith('  /') && lines[index].endsWith(':')) || lines[index] === 'components:') { pathEnd = index; break; }
    }
    next = [...lines.slice(0, pathEnd), '', ...methodBlock.split('\n'), ...lines.slice(pathEnd)].join('\n');
  }
  return next;
}

function addOpenApiOperations(raw, missing) {
  if (!missing.length) return { raw, added: 0 };
  let next = raw;
  let added = 0;
  const existingOperations = parseOpenApi(next);
  const existingKeys = new Set(existingOperations.map((item) => operationKey(item.method, item.path)));
  const grouped = new Map();
  for (const operation of missing) {
    const key = operationKey(operation.method, operation.path);
    if (existingKeys.has(key)) continue;
    const rawPath = openapiPathFromCanonical(operation.path);
    if (!grouped.has(rawPath)) grouped.set(rawPath, []);
    grouped.get(rawPath).push(operation);
  }
  const newPaths = [];
  for (const [rawPath, operations] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    operations.sort((left, right) => left.method.localeCompare(right.method));
    const methodBlocks = operations.map((operation) => buildOpenApiOperation(operation));
    if (next.split('\n').includes('  ' + rawPath + ':')) {
      const changed = insertIntoExistingPath(next, rawPath, methodBlocks);
      if (changed !== null) { next = changed; added += operations.length; }
    } else {
      newPaths.push('  ' + rawPath + ':\n' + methodBlocks.join('\n\n'));
      added += operations.length;
    }
  }
  if (newPaths.length) {
    const marker = '\ncomponents:\n';
    const index = next.indexOf(marker);
    if (index < 0) throw new Error('canonical OpenAPI components marker not found');
    next = next.slice(0, index) + '\n' + newPaths.join('\n\n') + '\n' + next.slice(index);
  }
  return { raw: next, added };
}
function buildOpenApiOperation({ operationId, method, canonicalPath, domain }) {
  const commerceBlock = buildCommerceOpenApiOperation({ operationId, method });
  if (commerceBlock) return commerceBlock;
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
