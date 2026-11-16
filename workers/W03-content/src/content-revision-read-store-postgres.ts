import {
  ContentRuntimeError,
  type ContentRevision,
  type ContentRevisionReadStore,
} from './content-runtime.js'

type RevisionPostgresRow = Readonly<{
  id: string
  content_id: string
  revision: number
  content_version: number
  actor_user_id: string
  source_revision: number | null
  operation: ContentRevision['operation']
  state: ContentRevision['state']
  access_mode?: ContentRevision['accessMode']
  slug: string
  title: string
  body_ref: string
  media_refs_json: string
  cover_ref: string | null
  media_warning?: ContentRevision['mediaWarning']
  etag: string
  reason: string | null
  correlation_id: string
  created_at: Date | string
}>

export interface ContentRevisionPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

const REVISION_COLUMNS = `
  r.id, r.content_id, r.revision, r.content_version, r.actor_user_id,
  r.source_revision, r.operation, r.state, r.access_mode, r.slug, r.title, r.body_ref,
  r.media_refs_json, r.cover_ref, r.media_warning, r.etag, r.reason, r.correlation_id, r.created_at
`

const timestampString = (value: Date | string): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CONTENT_REVISION_TIMESTAMP_INVALID')
}

const toRevision = (row: RevisionPostgresRow): ContentRevision => ({
  id: row.id,
  contentId: row.content_id,
  revision: row.revision,
  contentVersion: row.content_version,
  actorUserId: row.actor_user_id,
  sourceRevision: row.source_revision,
  operation: row.operation,
  state: row.state,
  accessMode: row.access_mode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC',
  slug: row.slug,
  title: row.title,
  bodyRef: row.body_ref,
  mediaRefs: JSON.parse(row.media_refs_json || '[]') as string[],
  coverRef: row.cover_ref,
  mediaWarning: row.media_warning ?? null,
  etag: row.etag,
  reason: row.reason,
  correlationId: row.correlation_id,
  createdAt: timestampString(row.created_at),
})

/**
 * Owner-scoped content revision history reader. The owner join is retained on
 * both endpoints so a revision ID can never be used to cross content ownership.
 */
export function createPostgresContentRevisionReadStore(
  database: ContentRevisionPostgresQueryExecutor,
): ContentRevisionReadStore {
  return {
    async list(principalUserId, contentId, cursor, limit) {
      const cursorClause = cursor
        ? 'AND (r.created_at < $3::timestamptz OR (r.created_at = $3::timestamptz AND r.id < $4))'
        : ''
      const values = cursor
        ? [contentId, principalUserId, cursor.updatedAt, cursor.id, limit]
        : [contentId, principalUserId, limit]
      const limitParameter = cursor ? '$5' : '$3'
      try {
        const result = await database.query<RevisionPostgresRow>(
          `SELECT ${REVISION_COLUMNS}
             FROM content_revisions r
             JOIN contents c ON c.id = r.content_id
            WHERE r.content_id = $1
              AND c.owner_user_id = $2
              ${cursorClause}
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT ${limitParameter}`,
          values,
        )
        return result.rows.map(toRevision)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async get(principalUserId, contentId, revisionId) {
      try {
        const result = await database.query<RevisionPostgresRow>(
          `SELECT ${REVISION_COLUMNS}
             FROM content_revisions r
             JOIN contents c ON c.id = r.content_id
            WHERE r.id = $1
              AND r.content_id = $2
              AND c.owner_user_id = $3
            LIMIT 1`,
          [revisionId, contentId, principalUserId],
        )
        return result.rows[0] ? toRevision(result.rows[0]) : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}
