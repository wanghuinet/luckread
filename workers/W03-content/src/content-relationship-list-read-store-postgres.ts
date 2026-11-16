import { ContentRuntimeError } from './content-runtime.js'
import type {
  ContentRelationshipDirection,
  ContentRelationshipReadCursor,
  ContentRelationshipReadStore,
  PublicContentRelationship,
} from './content-relationships.js'

type RelationshipListPostgresRow = Readonly<{
  relationship_id: string
  relation_type: 'reference'
  created_at: Date | string
  related_id: string
  related_slug: string
  related_type: 'article' | 'post' | 'video'
  related_title: string
  relation_direction: 'out' | 'in'
}>

export interface ContentRelationshipListPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CONTENT_RELATIONSHIP_TIMESTAMP_INVALID')
}

const validateInput = (
  contentId: string,
  direction: ContentRelationshipDirection,
  cursor: ContentRelationshipReadCursor | null,
  limit: number,
): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!['out', 'in', 'both'].includes(direction)) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  if (cursor && (
    !Number.isFinite(Date.parse(cursor.createdAt)) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(cursor.relationshipId)
  )) {
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
}

/** PostgreSQL reader for bounded public content-reference relationships. */
export function createPostgresContentRelationshipListReadStore(
  database: ContentRelationshipListPostgresQueryExecutor,
): ContentRelationshipReadStore {
  return {
    async list(contentId, direction, cursor, limit): Promise<readonly PublicContentRelationship[]> {
      validateInput(contentId, direction, cursor, limit)
      const cursorClause = cursor
        ? 'AND (r.created_at < $3::timestamptz OR (r.created_at = $3::timestamptz AND r.relationship_id < $4::text))'
        : ''
      const limitParameter = cursor ? '$5' : '$3'
      const values = cursor
        ? [contentId, direction, cursor.createdAt, cursor.relationshipId, limit]
        : [contentId, direction, limit]

      const sql = [
        'SELECT r.relationship_id, r.relation_type, r.created_at,',
        '       CASE WHEN r.source_id = $1 THEN t.id ELSE s.id END AS related_id,',
        '       CASE WHEN r.source_id = $1 THEN t.slug ELSE s.slug END AS related_slug,',
        '       CASE WHEN r.source_id = $1 THEN t.content_type ELSE s.content_type END AS related_type,',
        '       CASE WHEN r.source_id = $1 THEN t.title ELSE s.title END AS related_title,',
        "       CASE WHEN r.source_id = $1 THEN 'out' ELSE 'in' END AS relation_direction",
        '  FROM content_relationships r',
        '  JOIN contents s ON s.id = r.source_id',
        '  JOIN contents t ON t.id = r.target_id',
        " WHERE r.status = 'ACTIVE'",
        "   AND r.relation_type = 'reference'",
        "   AND s.state = 'PUBLISHED'",
        "   AND t.state = 'PUBLISHED'",
        "   AND (($2::text = 'out' AND r.source_id = $1)",
        "     OR ($2::text = 'in' AND r.target_id = $1)",
        "     OR ($2::text = 'both' AND (r.source_id = $1 OR r.target_id = $1)))",
        ` ${cursorClause}`,
        ' ORDER BY r.created_at DESC, r.relationship_id DESC',
        ` LIMIT ${limitParameter}`,
      ].join('\n')

      try {
        const result = await database.query<RelationshipListPostgresRow>(sql, values)
        return result.rows.map((row) => ({
          relationshipId: row.relationship_id,
          relationType: row.relation_type,
          direction: row.relation_direction,
          relatedContent: {
            id: row.related_id,
            slug: row.related_slug,
            contentType: row.related_type,
            title: row.related_title,
          },
          createdAt: timestampString(row.created_at),
        }))
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}
