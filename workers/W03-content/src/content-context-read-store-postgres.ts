import { isContentSlug } from './content-slug.js'
import {
  ContentRuntimeError,
  type OwnedPostContext,
  type PublishedContentAuthorContext,
  type PublishedContentSocialContext,
  type PublishedContentSocialSummaryContext,
} from './content-runtime.js'

export interface ContentContextPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>
}

/** Read-only projections that preserve W03 as the canonical content authority. */
export interface ContentContextReadStore {
  getPublishedContentAuthorContext(contentReference: string): Promise<PublishedContentAuthorContext>
  getOwnedPostContext(contentId: string, principalUserId: string): Promise<OwnedPostContext>
  getPublishedContentSocialContext(contentId: string): Promise<PublishedContentSocialContext>
  getPublishedContentSocialContexts(contentIds: string[]): Promise<PublishedContentSocialSummaryContext[]>
  getPublishedOwnerPostContext(contentId: string, ownerUserId: string): Promise<OwnedPostContext>
}

type ContextRow = Record<string, unknown> & {
  id: string
  owner_user_id: string | null
  content_type: string
  updated_at: string | Date
}

function timestampString(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
}

function assertResourceId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

function assertContentReference(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) && !isContentSlug(value)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

function assertContentType(value: string): void {
  if (!['article', 'post', 'video'].includes(value)) {
    throw new ContentRuntimeError('INTERNAL_ERROR', 500)
  }
}

async function queryRows<Row extends Record<string, unknown>>(
  database: ContentContextPostgresQueryExecutor,
  sql: string,
  values: unknown[],
): Promise<Row[]> {
  try {
    return (await database.query<Row>(sql, values)).rows
  } catch {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

/** PostgreSQL implementation for W01/W05 content-authority context reads. */
export function createPostgresContentContextReadStore(
  database: ContentContextPostgresQueryExecutor,
): ContentContextReadStore {
  return {
    async getPublishedContentAuthorContext(contentReference) {
      assertContentReference(contentReference)
      const rows = await queryRows<ContextRow>(
        database,
        `SELECT id, owner_user_id
           FROM contents
          WHERE (id = $1 OR slug = $1)
            AND state = 'PUBLISHED'
          LIMIT 1`,
        [contentReference],
      )
      const row = rows[0]
      if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
      if (typeof row.id !== 'string' || !row.id || typeof row.owner_user_id !== 'string' || !row.owner_user_id) {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
      return { contentId: row.id, ownerUserId: row.owner_user_id }
    },

    async getOwnedPostContext(contentIdValue, principalUserIdValue) {
      const contentId = contentIdValue.trim()
      const principalUserId = principalUserIdValue.trim()
      assertResourceId(contentId)
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(principalUserId)) {
        throw new ContentRuntimeError('UNAUTHENTICATED', 401)
      }
      const rows = await queryRows<ContextRow & { state: string }>(
        database,
        `SELECT id, owner_user_id, content_type, state, updated_at
           FROM contents
          WHERE id = $1
            AND owner_user_id = $2
            AND content_type = 'post'
            AND state IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')
          LIMIT 1`,
        [contentId, principalUserId],
      )
      const row = rows[0]
      if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
      if (typeof row.owner_user_id !== 'string' || !row.owner_user_id) {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
      return {
        contentId: row.id,
        ownerUserId: row.owner_user_id,
        contentType: 'post',
        state: row.state as OwnedPostContext['state'],
        updatedAt: timestampString(row.updated_at),
      }
    },

    async getPublishedContentSocialContext(contentIdValue) {
      const contentId = contentIdValue.trim()
      assertResourceId(contentId)
      const rows = await queryRows<ContextRow>(
        database,
        `SELECT id, owner_user_id, content_type, updated_at
           FROM contents
          WHERE id = $1 AND state = 'PUBLISHED'
          LIMIT 1`,
        [contentId],
      )
      const row = rows[0]
      if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
      assertContentType(row.content_type)
      return {
        contentId: row.id,
        ownerUserId: row.owner_user_id,
        contentType: row.content_type as PublishedContentSocialContext['contentType'],
        state: 'PUBLISHED',
        updatedAt: timestampString(row.updated_at),
      }
    },

    async getPublishedContentSocialContexts(contentIdsValue) {
      if (!Array.isArray(contentIdsValue) || contentIdsValue.length > 50) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }
      const contentIds = contentIdsValue.map(value => typeof value === 'string' ? value.trim() : '')
      if (contentIds.some(contentId => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId))) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }
      const uniqueContentIds = [...new Set(contentIds)]
      if (uniqueContentIds.length === 0) return []

      const rows = await queryRows<ContextRow & { title: string }>(
        database,
        `SELECT id, owner_user_id, content_type, title, updated_at
           FROM contents
          WHERE state = 'PUBLISHED'
            AND id = ANY($1::text[])`,
        [uniqueContentIds],
      )
      const byId = new Map<string, PublishedContentSocialSummaryContext>()
      for (const row of rows) {
        if (!uniqueContentIds.includes(row.id)) throw new ContentRuntimeError('INTERNAL_ERROR', 500)
        assertContentType(row.content_type)
        byId.set(row.id, {
          contentId: row.id,
          ownerUserId: row.owner_user_id,
          contentType: row.content_type as PublishedContentSocialSummaryContext['contentType'],
          state: 'PUBLISHED',
          title: row.title,
          updatedAt: timestampString(row.updated_at),
        })
      }
      return uniqueContentIds.flatMap(contentId => {
        const context = byId.get(contentId)
        return context ? [context] : []
      })
    },

    async getPublishedOwnerPostContext(contentIdValue, ownerUserIdValue) {
      const contentId = contentIdValue.trim()
      const ownerUserId = ownerUserIdValue.trim()
      assertResourceId(contentId)
      assertResourceId(ownerUserId)
      const rows = await queryRows<ContextRow>(
        database,
        `SELECT id, owner_user_id, content_type, updated_at
           FROM contents
          WHERE id = $1
            AND owner_user_id = $2
            AND content_type = 'post'
            AND state = 'PUBLISHED'
          LIMIT 1`,
        [contentId, ownerUserId],
      )
      const row = rows[0]
      if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
      if (typeof row.owner_user_id !== 'string' || !row.owner_user_id) {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
      return {
        contentId: row.id,
        ownerUserId: row.owner_user_id,
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: timestampString(row.updated_at),
      }
    },
  }
}
