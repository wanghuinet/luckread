import { ContentRuntimeError } from './content-runtime.js'
import type {
  CollectionMembersReadStore,
  CollectionMemberListCursor,
  CollectionMemberRecord,
} from './content-collection-members.js'
import type {
  SeriesMembersReadStore,
  SeriesMemberListCursor,
  SeriesMemberRecord,
} from './content-series-members.js'

export interface MembersPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

interface ParentRow {
  id: string
  version: number
  etag: string
}

interface MemberRowBase {
  relationship_id: string
  position: number
  created_at: Date | string
  updated_at: Date | string
  content_id: string
  content_slug: string
  content_type: 'article' | 'post' | 'video'
  content_state: string
  content_title: string
}

type SeriesMemberRow = MemberRowBase & { series_id: string }
type CollectionMemberRow = MemberRowBase & { collection_id: string }

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_MEMBER_TIMESTAMP_INVALID')
}

const toSeriesMember = (row: SeriesMemberRow): SeriesMemberRecord => ({
  relationshipId: row.relationship_id,
  seriesId: row.series_id,
  contentId: row.content_id,
  contentSlug: row.content_slug,
  contentType: row.content_type,
  contentState: row.content_state,
  title: row.content_title,
  position: row.position,
  createdAt: timestampString(row.created_at),
  updatedAt: timestampString(row.updated_at),
})

const toCollectionMember = (row: CollectionMemberRow): CollectionMemberRecord => ({
  relationshipId: row.relationship_id,
  collectionId: row.collection_id,
  contentId: row.content_id,
  contentSlug: row.content_slug,
  contentType: row.content_type,
  contentState: row.content_state,
  title: row.content_title,
  position: row.position,
  createdAt: timestampString(row.created_at),
  updatedAt: timestampString(row.updated_at),
})

const assertPageLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

/**
 * PostgreSQL read-only adapters for creator-owned series/collection member
 * lists. Membership mutations remain on D1; owner-scoped parent checks and the
 * existing cursor validation/encoding stay in their domain modules.
 */
export function createPostgresMembersReadStore(
  database: MembersPostgresQueryExecutor,
): {
  series: SeriesMembersReadStore
  collections: CollectionMembersReadStore
} {
  return {
    series: {
      async listSeriesMembers(
        ownerUserId: string,
        seriesId: string,
        cursor: SeriesMemberListCursor | null,
        limit: number,
      ) {
        assertPageLimit(limit)

        let parent: ParentRow | undefined
        try {
          const result = await database.query<ParentRow>(
            'SELECT id, version, etag FROM content_series WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
            [seriesId, ownerUserId],
          )
          parent = result.rows[0]
        } catch {
          throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
        }
        if (!parent) throw new ContentRuntimeError('NOT_FOUND', 404)

        try {
          const result = await database.query<SeriesMemberRow>(
            'SELECT r.relationship_id, r.position, r.created_at, r.updated_at, ' +
            'r.target_id AS series_id, c.id AS content_id, c.slug AS content_slug, ' +
            'c.content_type, c.state AS content_state, c.title AS content_title ' +
            'FROM content_relationships r ' +
            'JOIN contents c ON c.id = r.source_id ' +
            "WHERE r.source_type = 'content' AND r.target_type = 'series' AND r.relation_type = 'series-member' " +
            "AND r.target_id = $1 AND r.status = 'ACTIVE' " +
            'AND ($2::integer IS NULL OR (r.position, r.relationship_id) > ($2::integer, $3::text)) ' +
            'ORDER BY r.position ASC, r.relationship_id ASC LIMIT $4',
            [seriesId, cursor?.position ?? null, cursor?.id ?? null, limit],
          )
          return {
            items: result.rows.map(toSeriesMember),
            seriesVersion: parent.version,
            seriesEtag: parent.etag,
          }
        } catch {
          throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
        }
      },
    },

    collections: {
      async listCollectionMembers(
        ownerUserId: string,
        collectionId: string,
        cursor: CollectionMemberListCursor | null,
        limit: number,
      ) {
        assertPageLimit(limit)

        let parent: ParentRow | undefined
        try {
          const result = await database.query<ParentRow>(
            'SELECT id, version, etag FROM content_collections WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
            [collectionId, ownerUserId],
          )
          parent = result.rows[0]
        } catch {
          throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
        }
        if (!parent) throw new ContentRuntimeError('NOT_FOUND', 404)

        try {
          const result = await database.query<CollectionMemberRow>(
            'SELECT r.relationship_id, r.position, r.created_at, r.updated_at, ' +
            'r.target_id AS collection_id, c.id AS content_id, c.slug AS content_slug, ' +
            'c.content_type, c.state AS content_state, c.title AS content_title ' +
            'FROM content_relationships r ' +
            'JOIN contents c ON c.id = r.source_id ' +
            "WHERE r.source_type = 'content' AND r.target_type = 'collection' AND r.relation_type = 'collection-member' " +
            "AND r.target_id = $1 AND r.status = 'ACTIVE' " +
            'AND ($2::integer IS NULL OR (r.position, r.relationship_id) > ($2::integer, $3::text)) ' +
            'ORDER BY r.position ASC, r.relationship_id ASC LIMIT $4',
            [collectionId, cursor?.position ?? null, cursor?.id ?? null, limit],
          )
          return {
            items: result.rows.map(toCollectionMember),
            collectionVersion: parent.version,
            collectionEtag: parent.etag,
          }
        } catch {
          throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
        }
      },
    },
  }
}
