import { ContentRuntimeError } from './content-runtime.js'
import type {
  CollectionListCursor,
  CollectionListReadStore,
  CollectionRecord,
} from './content-collections.js'

export interface CollectionListPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

interface CollectionListRow {
  id: string
  owner_user_id: string
  creator_id: string
  state: CollectionRecord['state']
  version: number
  title: string
  description: string
  cover_ref: string | null
  etag: string
  created_at: Date | string
  updated_at: Date | string
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_COLLECTION_TIMESTAMP_INVALID')
}

const toCollectionRecord = (row: CollectionListRow): CollectionRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  creatorId: row.creator_id,
  state: row.state,
  version: row.version,
  title: row.title,
  description: row.description,
  coverRef: row.cover_ref,
  etag: row.etag,
  createdAt: timestampString(row.created_at),
  updatedAt: timestampString(row.updated_at),
})

/**
 * PostgreSQL equivalent of the bounded creator-owned collection list.
 * Collection writes and single-item reads remain on D1 until their own slices
 * are admitted; cursor scope and encoding stay in content-collections.ts.
 */
export function createPostgresCollectionListReadStore(
  database: CollectionListPostgresQueryExecutor,
): CollectionListReadStore {
  return {
    async getCollection(ownerUserId, collectionId): Promise<CollectionRecord | null> {
      try {
        const result = await database.query<CollectionListRow>(
          'SELECT id, owner_user_id, creator_id, state, version, title, description, ' +
          'cover_ref, etag, created_at, updated_at FROM content_collections ' +
          'WHERE owner_user_id = $1 AND id = $2 LIMIT 1',
          [ownerUserId, collectionId],
        )
        return result.rows[0] ? toCollectionRecord(result.rows[0]) : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async listCreatorCollections(
      ownerUserId: string,
      cursor: CollectionListCursor | null,
      limit: number,
    ): Promise<readonly CollectionRecord[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }

      const sql = [
        'SELECT id, owner_user_id, creator_id, state, version, title, description,',
        '       cover_ref, etag, created_at, updated_at',
        '  FROM content_collections',
        ' WHERE owner_user_id = $1',
        '   AND ($2::timestamptz IS NULL OR (updated_at, id) < ($2::timestamptz, $3::text))',
        ' ORDER BY updated_at DESC, id DESC',
        ' LIMIT $4',
      ].join('\n')

      try {
        const result = await database.query<CollectionListRow>(sql, [
          ownerUserId,
          cursor?.updatedAt ?? null,
          cursor?.id ?? null,
          limit,
        ])
        return result.rows.map(toCollectionRecord)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}
