import {
  ContentRuntimeError,
  decodeScopedCursor,
  encodeScopedCursor,
  type ContentD1,
} from './content-runtime.js'

export type ContentRelationshipStatus = 'ACTIVE' | 'REVOKED' | 'SUPERSEDED'
export type ContentRelationshipDirection = 'out' | 'in' | 'both'
export type ContentRelationshipType = 'reference' | 'thread-next'

export interface ContentRelationship {
  relationshipId: string
  sourceType: 'content'
  sourceId: string
  targetType: 'content'
  targetId: string
  relationType: ContentRelationshipType
  schemaVersion: number
  status: ContentRelationshipStatus
  actorId: string
  provenanceRef: string | null
  authorizationRef: string | null
  createdAt: string
  updatedAt: string
}

export interface PublicContentRelationship {
  relationshipId: string
  relationType: ContentRelationshipType
  direction: 'out' | 'in'
  relatedContent: {
    id: string
    slug: string
    contentType: 'article' | 'post' | 'video'
    title: string
  }
  createdAt: string
}

interface RelationshipRow {
  relationship_id: string
  source_type: 'content'
  source_id: string
  target_type: 'content'
  target_id: string
  relation_type: ContentRelationshipType
  schema_version: number
  status: ContentRelationshipStatus
  actor_id: string
  provenance_ref: string | null
  authorization_ref: string | null
  created_at: string
  updated_at: string
}

interface CreateRelationshipQueryRow {
  source_id: string
  owner_user_id: string
  source_version: number
  target_id: string | null
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_json: string | null
  idem_expires_at: string | null
  active_relationship_id: string | null
}

interface RevokeRelationshipQueryRow extends RelationshipRow {
  owner_user_id: string
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
  idem_response_json: string | null
  idem_expires_at: string | null
}

const MAX_REF_LENGTH = 2048
const PAGE_SIZE_MAX = 50
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

const assertContentId = (value: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const normalizeOptionalRef = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_REF_LENGTH) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

const relationshipHash = async (operationId: string, value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ operationId, value })),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const mapRow = (row: RelationshipRow): ContentRelationship => ({
  relationshipId: row.relationship_id,
  sourceType: row.source_type,
  sourceId: row.source_id,
  targetType: row.target_type,
  targetId: row.target_id,
  relationType: row.relation_type,
  schemaVersion: row.schema_version,
  status: row.status,
  actorId: row.actor_id,
  provenanceRef: row.provenance_ref,
  authorizationRef: row.authorization_ref,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const parseStoredRelationship = (value: string | null): ContentRelationship | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ContentRelationship
    if (
      parsed &&
      typeof parsed.relationshipId === 'string' &&
      parsed.sourceType === 'content' &&
      parsed.targetType === 'content' &&
      typeof parsed.sourceId === 'string' &&
      typeof parsed.targetId === 'string' &&
      (parsed.relationType === 'reference' || parsed.relationType === 'thread-next') &&
      (parsed.status === 'ACTIVE' || parsed.status === 'REVOKED') &&
      typeof parsed.schemaVersion === 'number' &&
      typeof parsed.actorId === 'string'
    ) {
      return parsed
    }
  } catch {
    // Corrupt idempotency data must not be returned as an authoritative relation.
  }
  return null
}

const relationLimit = (value: number): number =>
  Math.min(Math.max(Number.isSafeInteger(value) ? value : 20, 1), PAGE_SIZE_MAX)

const idempotencyActive = (row: { idem_id: string | null; idem_expires_at: string | null }, now: Date): boolean =>
  !!row.idem_id &&
  !!row.idem_expires_at &&
  Date.parse(row.idem_expires_at) > now.getTime()

const assertIdempotencyReplay = (
  row: { idem_id: string | null; idem_expires_at: string | null; idem_owner_user_id: string | null; idem_request_hash: string | null; idem_status: 'IN_PROGRESS' | 'COMPLETED' | null; idem_response_json: string | null },
  ownerUserId: string,
  hash: string,
  now: Date,
): ContentRelationship | null => {
  if (!idempotencyActive(row, now)) return null
  if (row.idem_owner_user_id !== ownerUserId || row.idem_request_hash !== hash) {
    throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  if (row.idem_status === 'IN_PROGRESS') {
    throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
  }
  const replay = parseStoredRelationship(row.idem_response_json)
  if (!replay) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  return replay
}

const relationshipMutationBatch = async (
  db: ContentD1,
  statements: D1PreparedStatement[],
): Promise<void> => {
  try {
    await db.batch(statements)
  } catch (error) {
    if (/UNIQUE constraint|constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
      throw new ContentRuntimeError('CONFLICT', 409)
    }
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const contentAndIdempotencyQuery = (operationId: string): string => `
SELECT
  s.id AS source_id,
  s.owner_user_id,
  s.version AS source_version,
  t.id AS target_id,
  i.id AS idem_id,
  i.owner_user_id AS idem_owner_user_id,
  i.request_hash AS idem_request_hash,
  i.status AS idem_status,
  i.response_json AS idem_response_json,
  i.expires_at AS idem_expires_at,
  (
    SELECT relationship_id
      FROM content_relationships r
     WHERE r.source_id = s.id
       AND r.target_id = t.id
       AND r.relation_type = 'reference'
       AND r.status = 'ACTIVE'
     LIMIT 1
  ) AS active_relationship_id
FROM contents s
LEFT JOIN contents t ON t.id = ?
LEFT JOIN (
  SELECT id, owner_user_id, request_hash, status, response_json, expires_at
    FROM content_mutation_idempotency
   WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
   ORDER BY created_at DESC
   LIMIT 1
) i ON 1 = 1
WHERE s.id = ?
`

export async function createContentRelationship(
  db: ContentD1,
  ownerUserId: string,
  sourceContentId: string,
  input: unknown,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRelationship> {
  assertContentId(ownerUserId)
  assertContentId(sourceContentId)
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const body = input as Record<string, unknown>
  const targetContentId = typeof body.targetContentId === 'string' ? body.targetContentId.trim() : ''
  const relationType = body.relationType === undefined ? 'reference' : body.relationType
  if (relationType !== 'reference') throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  assertContentId(targetContentId)
  if (targetContentId === sourceContentId) throw new ContentRuntimeError('VALIDATION_FAILED', 400)

  const provenanceRef = normalizeOptionalRef(body.provenanceRef)
  const authorizationRef = normalizeOptionalRef(body.authorizationRef)
  const operationId = 'createContentRelationship'
  const hash = await relationshipHash(operationId, {
    ownerUserId,
    sourceContentId,
    targetContentId,
    relationType,
    provenanceRef,
    authorizationRef,
  })

  const row = await db.prepare(contentAndIdempotencyQuery(operationId))
    .bind(targetContentId, ownerUserId, operationId, idempotencyKey, sourceContentId)
    .first<CreateRelationshipQueryRow>()

  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const replay = assertIdempotencyReplay(row, ownerUserId, hash, now)
  if (replay) return replay

  if (row.owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (!row.target_id) throw new ContentRuntimeError('NOT_FOUND', 404)
  if (row.active_relationship_id) throw new ContentRuntimeError('CONFLICT', 409)

  const createdAt = now.toISOString()
  const relationship: ContentRelationship = {
    relationshipId: crypto.randomUUID(),
    sourceType: 'content',
    sourceId: row.source_id,
    targetType: 'content',
    targetId: row.target_id,
    relationType: 'reference',
    schemaVersion: 1,
    status: 'ACTIVE',
    actorId: ownerUserId,
    provenanceRef,
    authorizationRef,
    createdAt,
    updatedAt: createdAt,
  }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await relationshipMutationBatch(db, [
    db.prepare(
      'DELETE FROM content_mutation_idempotency WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? AND expires_at <= ?',
    ).bind(ownerUserId, operationId, idempotencyKey, createdAt),
    db.prepare(
      `INSERT INTO content_mutation_idempotency
        (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', 201, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), ownerUserId, operationId, idempotencyKey, hash, JSON.stringify(relationship), createdAt, expiresAt),
    db.prepare(
      `INSERT INTO content_relationships
        (relationship_id, source_type, source_id, target_type, target_id, relation_type,
         schema_version, status, actor_id, provenance_ref, authorization_ref, created_at, updated_at)
       VALUES (?, 'content', ?, 'content', ?, 'reference', 1, 'ACTIVE', ?, ?, ?, ?, ?)`,
    ).bind(
      relationship.relationshipId,
      relationship.sourceId,
      relationship.targetId,
      relationship.actorId,
      relationship.provenanceRef,
      relationship.authorizationRef,
      relationship.createdAt,
      relationship.updatedAt,
    ),
    db.prepare('INSERT OR REPLACE INTO content_txn_guard(id, successful) VALUES (1, changes())'),
  ])

  return relationship
}

export async function listContentRelationships(
  db: ContentD1,
  contentId: string,
  direction: ContentRelationshipDirection = 'out',
  cursor: string | null = null,
  limit = 20,
): Promise<{ items: PublicContentRelationship[]; nextCursor: string | null; hasMore: boolean }> {
  assertContentId(contentId)
  if (!['out', 'in', 'both'].includes(direction)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const pageSize = relationLimit(limit)
  const cursorScope = JSON.stringify({ type: 'content-relationships', contentId, direction })
  const decoded = cursor ? decodeScopedCursor(cursor, cursorScope) : null
  const cursorClause = decoded
    ? 'AND (r.created_at < ? OR (r.created_at = ? AND r.relationship_id < ?))'
    : ''

  let predicate: string
  let select: string
  let bindings: unknown[]

  if (direction === 'out') {
    predicate = 'r.source_id = ?'
    select = "r.target_id AS related_id, t.slug AS related_slug, t.content_type AS related_type, t.title AS related_title, 'out' AS relation_direction"
    bindings = [contentId]
  } else if (direction === 'in') {
    predicate = 'r.target_id = ?'
    select = "r.source_id AS related_id, s.slug AS related_slug, s.content_type AS related_type, s.title AS related_title, 'in' AS relation_direction"
    bindings = [contentId]
  } else {
    predicate = '(r.source_id = ? OR r.target_id = ?)'
    select = "CASE WHEN r.source_id = ? THEN t.id ELSE s.id END AS related_id, CASE WHEN r.source_id = ? THEN t.slug ELSE s.slug END AS related_slug, CASE WHEN r.source_id = ? THEN t.content_type ELSE s.content_type END AS related_type, CASE WHEN r.source_id = ? THEN t.title ELSE s.title END AS related_title, CASE WHEN r.source_id = ? THEN 'out' ELSE 'in' END AS relation_direction"
    bindings = [contentId, contentId, contentId, contentId, contentId, contentId, contentId]
  }

  const query =
    'SELECT r.relationship_id, r.relation_type, r.created_at, ' + select +
    ' FROM content_relationships r' +
    ' JOIN contents s ON s.id = r.source_id' +
    ' JOIN contents t ON t.id = r.target_id' +
    " WHERE r.status = 'ACTIVE'" +
    " AND s.state = 'PUBLISHED'" +
    " AND t.state = 'PUBLISHED'" +
    " AND r.relation_type = 'reference'" +
    ' AND ' + predicate +
    ' ' + cursorClause +
    ' ORDER BY r.created_at DESC, r.relationship_id DESC' +
    ' LIMIT ?'

  const rows = await db.prepare(query).bind(...bindings, ...(decoded ? [decoded.updatedAt, decoded.updatedAt, decoded.id] : []), pageSize + 1).all<{
    relationship_id: string
    relation_type: ContentRelationshipType
    created_at: string
    related_id: string
    related_slug: string
    related_type: 'article' | 'post' | 'video'
    related_title: string
    relation_direction: 'out' | 'in'
  }>()

  const page = rows.results.slice(0, pageSize)
  const last = page.at(-1)
  return {
    items: page.map((row) => ({
      relationshipId: row.relationship_id,
      relationType: row.relation_type,
      direction: row.relation_direction,
      relatedContent: {
        id: row.related_id,
        slug: row.related_slug,
        contentType: row.related_type,
        title: row.related_title,
      },
      createdAt: row.created_at,
    })),
    hasMore: rows.results.length > pageSize,
    nextCursor: rows.results.length > pageSize && last
      ? encodeScopedCursor(last.created_at, last.relationship_id, cursorScope)
      : null,
  }
}

export async function revokeContentRelationship(
  db: ContentD1,
  ownerUserId: string,
  sourceContentId: string,
  relationshipId: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRelationship> {
  assertContentId(ownerUserId)
  assertContentId(sourceContentId)
  assertContentId(relationshipId)
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  }

  const operationId = 'revokeContentRelationship'
  const row = await db.prepare(
    `SELECT
       r.relationship_id, r.source_type, r.source_id, r.target_type, r.target_id,
       r.relation_type, r.schema_version, r.status, r.actor_id,
       r.provenance_ref, r.authorization_ref, r.created_at, r.updated_at,
       c.owner_user_id,
       i.id AS idem_id,
       i.owner_user_id AS idem_owner_user_id,
       i.request_hash AS idem_request_hash,
       i.status AS idem_status,
       i.response_json AS idem_response_json,
       i.expires_at AS idem_expires_at
      FROM content_relationships r
      JOIN contents c ON c.id = r.source_id
      LEFT JOIN (
        SELECT id, owner_user_id, request_hash, status, response_json, expires_at
          FROM content_mutation_idempotency
         WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
         ORDER BY created_at DESC
         LIMIT 1
      ) i ON 1 = 1
     WHERE r.relationship_id = ? AND r.source_id = ?`,
  ).bind(ownerUserId, operationId, idempotencyKey, relationshipId, sourceContentId).first<RevokeRelationshipQueryRow>()

  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)

  const source = mapRow(row)
  const hash = await relationshipHash(operationId, { ownerUserId, relationshipId })
  const replay = assertIdempotencyReplay(row, ownerUserId, hash, now)
  if (replay) return replay

  if (row.owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403)
  if (row.status !== 'ACTIVE') throw new ContentRuntimeError('INVALID_STATE', 409)

  const updatedAt = now.toISOString()
  const response: ContentRelationship = { ...source, status: 'REVOKED', updatedAt }
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  await relationshipMutationBatch(db, [
    db.prepare(
      'DELETE FROM content_mutation_idempotency WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? AND expires_at <= ?',
    ).bind(ownerUserId, operationId, idempotencyKey, updatedAt),
    db.prepare(
      `INSERT INTO content_mutation_idempotency
        (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', 200, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), ownerUserId, operationId, idempotencyKey, hash, JSON.stringify(response), updatedAt, expiresAt),
    db.prepare(
      `UPDATE content_relationships
          SET status = 'REVOKED', updated_at = ?
        WHERE relationship_id = ? AND status = 'ACTIVE'`,
    ).bind(updatedAt, relationshipId),
    db.prepare('INSERT OR REPLACE INTO content_txn_guard(id, successful) VALUES (1, changes())'),
  ])

  return response
}


export const MAX_POST_THREAD_ITEMS = 50;

export interface PostThreadItem {
  id: string;
  slug: string;
  position: number;
  contentType: 'post';
  state: 'DRAFT' | 'PUBLISHED';
  accessMode: 'PUBLIC';
  title: string;
  bodyRef: string;
  mediaRefs: string[];
  coverRef: string | null;
  createdAt: string;
}

interface AppendPostThreadQueryRow {
  source_id: string;
  source_owner_user_id: string;
  source_content_type: string;
  source_state: string;
  source_access_mode: string;
  target_id: string | null;
  target_owner_user_id: string | null;
  target_content_type: string | null;
  target_state: string | null;
  target_access_mode: string | null;
  idem_id: string | null;
  idem_owner_user_id: string | null;
  idem_request_hash: string | null;
  idem_status: 'IN_PROGRESS' | 'COMPLETED' | null;
  idem_response_json: string | null;
  idem_expires_at: string | null;
}

interface PostThreadChainStats {
  previous_count: number;
  next_count: number;
  would_cycle: number;
  source_has_next: number;
  target_has_previous: number;
}

/**
 * Append one independently-addressable social post to a thread.
 * The content rows remain canonical W03 posts; only the ordered relationship
 * lives here. Each post can have at most one predecessor and one successor.
 */
export async function appendPostThreadNext(
  db: ContentD1,
  ownerUserIdValue: string,
  sourceContentIdValue: string,
  targetContentIdValue: string,
  idempotencyKey: string,
  now = new Date(),
): Promise<ContentRelationship> {
  const ownerUserId = ownerUserIdValue.trim();
  const sourceContentId = sourceContentIdValue.trim();
  const targetContentId = targetContentIdValue.trim();
  assertContentId(ownerUserId);
  assertContentId(sourceContentId);
  assertContentId(targetContentId);
  if (sourceContentId === targetContentId) throw new ContentRuntimeError('VALIDATION_FAILED', 400);
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428);
  }

  const operationId = 'appendPostThreadNext';
  const hash = await relationshipHash(operationId, { ownerUserId, sourceContentId, targetContentId });
  const row = await db.prepare(`
    SELECT
      s.id AS source_id,
      s.owner_user_id AS source_owner_user_id,
      s.content_type AS source_content_type,
      s.state AS source_state,
      s.access_mode AS source_access_mode,
      t.id AS target_id,
      t.owner_user_id AS target_owner_user_id,
      t.content_type AS target_content_type,
      t.state AS target_state,
      t.access_mode AS target_access_mode,
      i.id AS idem_id,
      i.owner_user_id AS idem_owner_user_id,
      i.request_hash AS idem_request_hash,
      i.status AS idem_status,
      i.response_json AS idem_response_json,
      i.expires_at AS idem_expires_at
    FROM contents s
    LEFT JOIN contents t ON t.id = ?
    LEFT JOIN (
      SELECT id, owner_user_id, request_hash, status, response_json, expires_at
        FROM content_mutation_idempotency
       WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
       ORDER BY created_at DESC
       LIMIT 1
    ) i ON 1 = 1
    WHERE s.id = ?
  `).bind(targetContentId, ownerUserId, operationId, idempotencyKey, sourceContentId)
    .first<AppendPostThreadQueryRow>();

  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404);
  const replay = assertIdempotencyReplay(row, ownerUserId, hash, now);
  if (replay) return replay;

  if (row.source_owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403);
  if (!row.target_id) throw new ContentRuntimeError('NOT_FOUND', 404);
  if (row.target_owner_user_id !== ownerUserId) throw new ContentRuntimeError('PERMISSION_DENIED', 403);
  if (row.source_content_type !== 'post' || row.target_content_type !== 'post') {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400);
  }
  if (
    !['DRAFT', 'PUBLISHED'].includes(row.source_state) ||
    row.target_state === null ||
    !['DRAFT', 'PUBLISHED'].includes(row.target_state) ||
    row.source_access_mode !== 'PUBLIC' ||
    row.target_access_mode !== 'PUBLIC'
  ) {
    throw new ContentRuntimeError('INVALID_STATE', 409);
  }

  // The edge joins the tail of one chain to the head of another. This prevents
  // forks/merges and checks the combined chain length and cycle condition.
  const stats = await db.prepare(`
    WITH RECURSIVE
      previous(id, depth, visited) AS (
        SELECT ?, 0, '|' || ? || '|'
        UNION ALL
        SELECT r.source_id, p.depth + 1, p.visited || r.source_id || '|'
          FROM previous p
          JOIN content_relationships r
            ON r.target_id = p.id
           AND r.relation_type = 'thread-next'
           AND r.status = 'ACTIVE'
         WHERE p.depth < ?
           AND instr(p.visited, '|' || r.source_id || '|') = 0
      ),
      next(id, depth, visited) AS (
        SELECT ?, 0, '|' || ? || '|'
        UNION ALL
        SELECT r.target_id, n.depth + 1, n.visited || r.target_id || '|'
          FROM next n
          JOIN content_relationships r
            ON r.source_id = n.id
           AND r.relation_type = 'thread-next'
           AND r.status = 'ACTIVE'
         WHERE n.depth < ?
           AND instr(n.visited, '|' || r.target_id || '|') = 0
      )
    SELECT
      (SELECT COUNT(*) FROM previous) AS previous_count,
      (SELECT COUNT(*) FROM next) AS next_count,
      EXISTS(SELECT 1 FROM next WHERE id = ?) AS would_cycle,
      EXISTS(
        SELECT 1 FROM content_relationships
         WHERE source_id = ? AND relation_type = 'thread-next' AND status = 'ACTIVE'
      ) AS source_has_next,
      EXISTS(
        SELECT 1 FROM content_relationships
         WHERE target_id = ? AND relation_type = 'thread-next' AND status = 'ACTIVE'
      ) AS target_has_previous
  `).bind(
    sourceContentId, sourceContentId, MAX_POST_THREAD_ITEMS,
    targetContentId, targetContentId, MAX_POST_THREAD_ITEMS,
    sourceContentId, sourceContentId, targetContentId,
  ).first<PostThreadChainStats>();

  if (!stats) throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503);
  if (stats.source_has_next || stats.target_has_previous) throw new ContentRuntimeError('CONFLICT', 409);
  if (stats.would_cycle) throw new ContentRuntimeError('VALIDATION_FAILED', 400);
  if (stats.previous_count + stats.next_count > MAX_POST_THREAD_ITEMS) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400);
  }

  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  const relationship: ContentRelationship = {
    relationshipId: crypto.randomUUID(),
    sourceType: 'content',
    sourceId: sourceContentId,
    targetType: 'content',
    targetId: targetContentId,
    relationType: 'thread-next',
    schemaVersion: 1,
    status: 'ACTIVE',
    actorId: ownerUserId,
    provenanceRef: null,
    authorizationRef: null,
    createdAt,
    updatedAt: createdAt,
  };

  await relationshipMutationBatch(db, [
    db.prepare(
      'DELETE FROM content_mutation_idempotency WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? AND expires_at <= ?',
    ).bind(ownerUserId, operationId, idempotencyKey, createdAt),
    db.prepare(`
      INSERT INTO content_mutation_idempotency
        (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'COMPLETED', 201, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), ownerUserId, operationId, idempotencyKey, hash,
      JSON.stringify(relationship), createdAt, expiresAt,
    ),
    db.prepare(`
      WITH RECURSIVE
        descendants(id, depth, visited) AS (
          SELECT ?, 0, '|' || ? || '|'
          UNION ALL
          SELECT r.target_id, d.depth + 1, d.visited || r.target_id || '|'
            FROM descendants d
            JOIN content_relationships r
              ON r.source_id = d.id
             AND r.relation_type = 'thread-next'
             AND r.status = 'ACTIVE'
           WHERE d.depth < ?
             AND instr(d.visited, '|' || r.target_id || '|') = 0
        ),
        ancestors(id, depth, visited) AS (
          SELECT ?, 0, '|' || ? || '|'
          UNION ALL
          SELECT r.source_id, a.depth + 1, a.visited || r.source_id || '|'
            FROM ancestors a
            JOIN content_relationships r
              ON r.target_id = a.id
             AND r.relation_type = 'thread-next'
             AND r.status = 'ACTIVE'
           WHERE a.depth < ?
             AND instr(a.visited, '|' || r.source_id || '|') = 0
        )
      INSERT INTO content_relationships
        (relationship_id, source_type, source_id, target_type, target_id, relation_type,
         position, schema_version, status, actor_id, provenance_ref, authorization_ref, created_at, updated_at)
      SELECT ?, 'content', s.id, 'content', t.id, 'thread-next',
             NULL, 1, 'ACTIVE', ?, NULL, NULL, ?, ?
        FROM contents s
        JOIN contents t ON t.id = ?
       WHERE s.id = ? AND s.owner_user_id = ? AND t.owner_user_id = ?
         AND s.content_type = 'post' AND t.content_type = 'post'
         AND s.state IN ('DRAFT', 'PUBLISHED') AND t.state IN ('DRAFT', 'PUBLISHED')
         AND s.access_mode = 'PUBLIC' AND t.access_mode = 'PUBLIC'
         AND NOT EXISTS (
           SELECT 1 FROM content_relationships r
            WHERE r.source_id = s.id AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE'
         )
         AND NOT EXISTS (
           SELECT 1 FROM content_relationships r
            WHERE r.target_id = t.id AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE'
         )
         AND NOT EXISTS (SELECT 1 FROM descendants WHERE id = s.id)
         AND (SELECT COUNT(*) FROM descendants) +
             (SELECT COUNT(*) FROM ancestors) <= ?
    `).bind(
      targetContentId, targetContentId, MAX_POST_THREAD_ITEMS,
      sourceContentId, sourceContentId, MAX_POST_THREAD_ITEMS,
      relationship.relationshipId, ownerUserId, createdAt, createdAt,
      targetContentId, sourceContentId, ownerUserId, ownerUserId,
      MAX_POST_THREAD_ITEMS,
    ),
    db.prepare('INSERT OR REPLACE INTO content_txn_guard(id, successful) VALUES (1, changes())'),
  ]);

  return relationship;
}

export async function listPostThread(
  db: ContentD1,
  contentIdValue: string,
  viewerUserIdValue: string | null = null,
): Promise<{ rootContentId: string; items: PostThreadItem[] }> {
  const contentId = contentIdValue.trim();
  assertContentId(contentId);
  const viewerUserId = viewerUserIdValue?.trim() || null;
  if (viewerUserId) assertContentId(viewerUserId);

  const rows = await db.prepare(`
    WITH RECURSIVE
      ancestors(id, owner_user_id, depth, visited) AS (
        SELECT id, owner_user_id, 0, '|' || id || '|' FROM contents WHERE id = ?
        UNION ALL
        SELECT r.source_id, a.owner_user_id, a.depth + 1, a.visited || r.source_id || '|'
          FROM ancestors a
          JOIN content_relationships r
            ON r.target_id = a.id
           AND r.relation_type = 'thread-next'
           AND r.status = 'ACTIVE'
          JOIN contents previous_content
            ON previous_content.id = r.source_id
           AND previous_content.owner_user_id = a.owner_user_id
         WHERE a.depth < ?
           AND instr(a.visited, '|' || r.source_id || '|') = 0
      ),
      root(id, owner_user_id) AS (
        SELECT id, owner_user_id FROM ancestors ORDER BY depth DESC LIMIT 1
      ),
      thread(id, owner_user_id, position, visited) AS (
        SELECT root.id, root.owner_user_id, 0, '|' || root.id || '|'
          FROM root
          JOIN contents root_content ON root_content.id = root.id
         WHERE (
           (root_content.state = 'PUBLISHED' AND root_content.access_mode = 'PUBLIC')
           OR (? IS NOT NULL AND root.owner_user_id = ? AND root_content.state IN ('DRAFT', 'PUBLISHED'))
         )
        UNION ALL
        SELECT r.target_id, t.owner_user_id, t.position + 1, t.visited || r.target_id || '|'
          FROM thread t
          JOIN content_relationships r
            ON r.source_id = t.id
           AND r.relation_type = 'thread-next'
           AND r.status = 'ACTIVE'
          JOIN contents next_content
            ON next_content.id = r.target_id
           AND next_content.owner_user_id = t.owner_user_id
         WHERE t.position + 1 < ?
           AND instr(t.visited, '|' || r.target_id || '|') = 0
           AND (
             (next_content.state = 'PUBLISHED' AND next_content.access_mode = 'PUBLIC')
             OR (? IS NOT NULL AND t.owner_user_id = ? AND next_content.state IN ('DRAFT', 'PUBLISHED'))
           )
      )
    SELECT
      c.id, c.slug, t.position, c.state, c.access_mode, c.title,
      c.body_ref, c.media_refs_json, c.cover_ref, c.created_at
      FROM thread t
      JOIN contents c ON c.id = t.id
     ORDER BY t.position ASC
  `).bind(
    contentId, MAX_POST_THREAD_ITEMS,
    viewerUserId, viewerUserId,
    MAX_POST_THREAD_ITEMS,
    viewerUserId, viewerUserId,
  ).all<{
    id: string;
    slug: string;
    position: number;
    state: 'DRAFT' | 'PUBLISHED';
    access_mode: 'PUBLIC';
    title: string;
    body_ref: string;
    media_refs_json: string;
    cover_ref: string | null;
    created_at: string;
  }>();

  if (!rows.results.length) throw new ContentRuntimeError('NOT_FOUND', 404);
  const items = rows.results.map((row): PostThreadItem => {
    let mediaRefs: unknown;
    try { mediaRefs = JSON.parse(row.media_refs_json || '[]'); } catch {
      throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
    if (!Array.isArray(mediaRefs) || mediaRefs.some((item) => typeof item !== 'string')) {
      throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
    return {
      id: row.id,
      slug: row.slug,
      position: row.position,
      contentType: 'post',
      state: row.state,
      accessMode: row.access_mode,
      title: row.title,
      bodyRef: row.body_ref,
      mediaRefs: mediaRefs as string[],
      coverRef: row.cover_ref,
      createdAt: row.created_at,
    };
  });
  return { rootContentId: items[0].id, items };
}
