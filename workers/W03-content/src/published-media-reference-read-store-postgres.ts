import {
  normalizePublishedMediaReferenceLookup,
  PublishedMediaReferenceReadStoreError,
  type PublishedMediaReferenceReadStore,
  type PublishedMediaReferenceRecord,
} from './published-media-reference-read-store.js'

export interface PublishedMediaReferencePostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

/**
 * PostgreSQL 18 counterpart for disposable D1-02 rehearsal.
 * The canonical schema stores media_refs_json as TEXT, so cast it to JSONB
 * before using the top-level array membership operator.
 */
export function createPostgresPublishedMediaReferenceReadStore(
  database: PublishedMediaReferencePostgresQueryExecutor,
): PublishedMediaReferenceReadStore {
  return {
    async listPublishedMediaReferences(rawCandidates, rawLimit) {
      const { candidates, limit } = normalizePublishedMediaReferenceLookup(rawCandidates, rawLimit)
      if (candidates.length === 0) return []
      const sql = [
        'SELECT id, owner_user_id, creator_id, content_type, access_mode',
        'FROM contents',
        "WHERE state = 'PUBLISHED'",
        '  AND (',
        '    body_ref = ANY($1::text[])',
        '    OR cover_ref = ANY($1::text[])',
        '    OR (contents.media_refs_json::jsonb ?| $1::text[])',
        '  )',
        'ORDER BY id ASC',
        'LIMIT $2',
      ].join('\n')
      try {
        const result = await database.query<PublishedMediaReferenceRecord>(sql, [candidates, limit])
        return result.rows
      } catch {
        throw new PublishedMediaReferenceReadStoreError('QUERY_FAILED')
      }
    },
  }
}
