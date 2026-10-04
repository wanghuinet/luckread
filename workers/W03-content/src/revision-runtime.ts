import {
  ContentRuntimeError,
  type ContentD1,
  type ContentRecord,
} from './content-runtime.js'

type RevisionRow = {
  revision_id: string
  content_id: string
  revision_number: number
  content_version: number
  title: string
  body_ref: string
  media_refs_json: string
  cover_ref: string | null
  state: ContentRecord['state']
  actor_user_id: string
  source_revision_id: string | null
  reason: string | null
  correlation_id: string
  created_at: string
}

export type ContentRevision = {
  revisionId: string
  contentId: string
  revisionNumber: number
  contentVersion: number
  title: string
  bodyRef: string
  mediaRefs: string[]
  coverRef: string | null
  state: ContentRecord['state']
  actorUserId: string
  sourceRevisionId: string | null
  reason: string | null
  correlationId: string
  createdAt: string
}

const encodeCursor = (row: Pick<RevisionRow, 'created_at' | 'revision_id'>): string => {
  const payload = JSON.stringify({ createdAt: row.created_at, revisionId: row.revision_id })
  let binary = ''
  for (const byte of new TextEncoder().encode(payload)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const decodeCursor = (value: string): { createdAt: string; revisionId: string } => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { createdAt?: unknown; revisionId?: unknown }
    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.revisionId !== 'string' ||
      parsed.revisionId.length < 1 ||
      parsed.revisionId.length > 128
    ) throw new Error('invalid cursor')
    return { createdAt: parsed.createdAt, revisionId: parsed.revisionId }
  } catch {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const assertId = (value: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const parseLimit = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  return Math.min(value, 50)
}

const toRevision = (row: RevisionRow): ContentRevision => ({
  revisionId: row.revision_id,
  contentId: row.content_id,
  revisionNumber: row.revision_number,
  contentVersion: row.content_version,
  title: row.title,
  bodyRef: row.body_ref,
  mediaRefs: JSON.parse(row.media_refs_json || '[]') as string[],
  coverRef: row.cover_ref,
  state: row.state,
  actorUserId: row.actor_user_id,
  sourceRevisionId: row.source_revision_id,
  reason: row.reason,
  correlationId: row.correlation_id,
  createdAt: row.created_at,
})

export function revisionInsertStatement(
  db: ContentD1,
  input: {
    revisionId: string
    contentId: string
    revisionNumber: number
    contentVersion: number
    title: string
    bodyRef: string
    mediaRefs: string[]
    coverRef: string | null
    state: ContentRecord['state']
    actorUserId: string
    sourceRevisionId?: string | null
    reason?: string | null
    correlationId: string
    createdAt: string
  },
) {
  return db.prepare(
    `INSERT INTO content_revisions
      (revision_id, content_id, revision_number, content_version, title, body_ref, media_refs_json, cover_ref,
       state, actor_user_id, source_revision_id, reason, correlation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.revisionId,
    input.contentId,
    input.revisionNumber,
    input.contentVersion,
    input.title,
    input.bodyRef,
    JSON.stringify(input.mediaRefs),
    input.coverRef,
    input.state,
    input.actorUserId,
    input.sourceRevisionId ?? null,
    input.reason ?? null,
    input.correlationId,
    input.createdAt,
  )
}

export async function listContentRevisions(
  db: ContentD1,
  ownerUserId: string,
  contentId: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: ContentRevision[]; nextCursor: string | null; hasMore: boolean }> {
  assertId(ownerUserId)
  assertId(contentId)
  const pageSize = parseLimit(limit)
  const decoded = cursor ? decodeCursor(cursor) : null
  const conditions = ['c.id = ?', 'c.owner_user_id = ?']
  const bindings: unknown[] = [contentId, ownerUserId]

  if (decoded) {
    conditions.push('(r.created_at < ? OR (r.created_at = ? AND r.revision_id < ?))')
    bindings.push(decoded.createdAt, decoded.createdAt, decoded.revisionId)
  }

  const result = await db.prepare(
    `SELECT
       r.revision_id, r.content_id, r.revision_number, r.content_version,
       r.title, r.body_ref, r.media_refs_json, r.cover_ref, r.state,
       r.actor_user_id, r.source_revision_id, r.reason, r.correlation_id, r.created_at
     FROM content_revisions r
     INNER JOIN contents c ON c.id = r.content_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC, r.revision_id DESC
     LIMIT ?`,
  ).bind(...bindings, pageSize + 1).all<RevisionRow>()

  const rows = result.results ?? []
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(toRevision)
  const last = rows[pageSize - 1]

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  }
}

export async function getContentRevision(
  db: ContentD1,
  ownerUserId: string,
  contentId: string,
  revisionId: string,
): Promise<ContentRevision> {
  assertId(ownerUserId)
  assertId(contentId)
  assertId(revisionId)

  const row = await db.prepare(
    `SELECT
       r.revision_id, r.content_id, r.revision_number, r.content_version,
       r.title, r.body_ref, r.media_refs_json, r.cover_ref, r.state,
       r.actor_user_id, r.source_revision_id, r.reason, r.correlation_id, r.created_at
     FROM content_revisions r
     INNER JOIN contents c ON c.id = r.content_id
     WHERE r.content_id = ? AND r.revision_id = ? AND c.owner_user_id = ?
     LIMIT 1`,
  ).bind(contentId, revisionId, ownerUserId).first<RevisionRow>()

  if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
  return toRevision(row)
}

export async function rollbackContentRevision(
  db: ContentD1,
  ownerUserId: string,
  contentId: string,
  revisionId: string,
  ifMatch: string,
  idempotencyKey: string,
  reason: string | undefined,
  now = new Date(),
): Promise<ContentRecord> {
  assertId(ownerUserId)
  assertId(contentId)
  assertId(revisionId)
  if (!ifMatch || !idempotencyKey) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)
  if (idempotencyKey.length > 256) throw new ContentRuntimeError('PRECONDITION_REQUIRED', 428)

  const source = await db.prepare(
    `SELECT
       r.revision_id, r.content_id, r.revision_number, r.content_version,
       r.title, r.body_ref, r.media_refs_json, r.cover_ref, r.state,
       r.actor_user_id, r.source_revision_id, r.reason, r.correlation_id, r.created_at
     FROM content_revisions r
     WHERE r.content_id = ? AND r.revision_id = ?
     LIMIT 1`,
  ).bind(contentId, revisionId).first<RevisionRow>()

  if (!source) throw new ContentRuntimeError('NOT_FOUND', 404)

  const current = await db.prepare(
    `SELECT id, content_type, owner_user_id, creator_id, ip_id, state, version, revision,
            title, body_ref, media_refs_json, cover_ref, etag, created_at, updated_at
       FROM contents
      WHERE id = ? AND owner_user_id = ?
      LIMIT 1`,
  ).bind(contentId, ownerUserId).first<{
    id: string
    content_type: ContentRecord['contentType']
    owner_user_id: string
    creator_id: string | null
    ip_id: string | null
    state: ContentRecord['state']
    version: number
    revision: number
    title: string
    body_ref: string
    media_refs_json: string
    cover_ref: string | null
    etag: string
    created_at: string
    updated_at: string
  }>()

  if (!current) throw new ContentRuntimeError('NOT_FOUND', 404)

  const normalizedIfMatch = ifMatch.trim().replace(/^W\//, '').replace(/^"/, '').replace(/"$/, '')
  const actualEtag = current.etag.replace(/^W\//, '').replace(/^"/, '').replace(/"$/, '')
  if (normalizedIfMatch !== actualEtag) throw new ContentRuntimeError('PRECONDITION_FAILED', 412)

  const effectiveReason = (reason ?? '').trim()
  if (effectiveReason.length > 2048) throw new ContentRuntimeError('VALIDATION_FAILED', 400)

  const requestHash = await sha256Hex(JSON.stringify({
    operationId: 'rollbackContentRevision',
    contentId,
    revisionId,
    ifMatch: normalizedIfMatch,
    reason: effectiveReason,
  }))

  const existing = await db.prepare(
    `SELECT
       id AS idem_id, owner_user_id AS idem_owner_user_id, request_hash AS idem_request_hash,
       status AS idem_status, response_status AS idem_response_status, response_json AS idem_response_json,
       expires_at AS idem_expires_at
     FROM content_mutation_idempotency
     WHERE owner_user_id = ? AND operation_id = 'rollbackContentRevision' AND idempotency_key = ?
     LIMIT 1`,
  ).bind(ownerUserId, idempotencyKey).first<{
    idem_id: string | null
    idem_owner_user_id: string | null
    idem_request_hash: string | null
    idem_status: 'IN_PROGRESS' | 'COMPLETED' | null
    idem_response_status: number | null
    idem_response_json: string | null
    idem_expires_at: string | null
  }>()

  if (existing?.idem_id && existing.idem_expires_at && Date.parse(existing.idem_expires_at) > now.getTime()) {
    if (existing.idem_request_hash !== requestHash) {
      throw new ContentRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
    }
    if (existing.idem_status === 'IN_PROGRESS') {
      throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    }
    if (existing.idem_response_json) return JSON.parse(existing.idem_response_json) as ContentRecord
  }

  const updatedAt = now.toISOString()
  const nextVersion = current.version + 1
  const nextRevision = current.revision + 1
  const nextEtag = `W/"${nextVersion}"`
  const correlationId = crypto.randomUUID()

  const updated: ContentRecord = {
    id: current.id,
    contentType: current.content_type,
    ownerUserId: current.owner_user_id,
    creatorId: current.creator_id,
    ipId: current.ip_id,
    state: 'DRAFT',
    version: nextVersion,
    revision: nextRevision,
    title: source.title,
    bodyRef: source.body_ref,
    mediaRefs: JSON.parse(source.media_refs_json || '[]') as string[],
    coverRef: source.cover_ref,
    etag: nextEtag,
    createdAt: current.created_at,
    updatedAt,
  }

  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const responseJson = JSON.stringify(updated)

  try {
    await db.batch([
      db.prepare(
        `DELETE FROM content_mutation_idempotency
          WHERE owner_user_id = ? AND operation_id = 'rollbackContentRevision'
            AND idempotency_key = ? AND expires_at <= ?`,
      ).bind(ownerUserId, idempotencyKey, updatedAt),
      db.prepare(
        `INSERT INTO content_mutation_idempotency
          (id, owner_user_id, operation_id, idempotency_key, request_hash, status,
           response_status, response_json, created_at, expires_at)
         VALUES (?, ?, 'rollbackContentRevision', ?, ?, 'COMPLETED', 200, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        ownerUserId,
        idempotencyKey,
        requestHash,
        responseJson,
        updatedAt,
        expiresAt,
      ),
      db.prepare(
        `UPDATE contents
            SET title=?, body_ref=?, media_refs_json=?, cover_ref=?, state='DRAFT',
                version=?, revision=?, etag=?, updated_at=?
          WHERE id=? AND owner_user_id=? AND version=? AND etag=?`,
      ).bind(
        updated.title,
        updated.bodyRef,
        JSON.stringify(updated.mediaRefs),
        updated.coverRef,
        updated.version,
        updated.revision,
        updated.etag,
        updated.updatedAt,
        contentId,
        ownerUserId,
        current.version,
        current.etag,
      ),
      db.prepare(`INSERT INTO content_txn_guard(id, successful)
                  VALUES (1, changes())`),
      revisionInsertStatement(db, {
        revisionId: crypto.randomUUID(),
        contentId,
        revisionNumber: nextRevision,
        contentVersion: nextVersion,
        title: updated.title,
        bodyRef: updated.bodyRef,
        mediaRefs: updated.mediaRefs,
        coverRef: updated.coverRef,
        state: updated.state,
        actorUserId: ownerUserId,
        sourceRevisionId: revisionId,
        reason: effectiveReason || 'rollback',
        correlationId,
        createdAt: updatedAt,
      }),
    ])
  } catch (error) {
    if (error instanceof ContentRuntimeError) throw error
    if (/UNIQUE constraint|constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
      throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
    }
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  return updated
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
