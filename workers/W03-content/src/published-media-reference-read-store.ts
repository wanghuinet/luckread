export type PublishedMediaReferenceRecord = Readonly<{
  id: string
  owner_user_id: string
  creator_id: string | null
  content_type: 'article' | 'post' | 'video'
  access_mode: 'PUBLIC' | 'MEMBERS_ONLY'
}>

export type W03PublishedMediaReferenceRuntimeEnv = Readonly<{
  D1_02?: PublishedMediaReferenceD1Database
  W03_PUBLIC_MEDIA_REFERENCE_DRIVER?: string
  HYPERDRIVE_D1_02?: Readonly<{ connectionString?: string }>
}>

export interface PublishedMediaReferenceReadStore {
  listPublishedMediaReferences(
    candidates: readonly string[],
    limit: number,
  ): Promise<readonly PublishedMediaReferenceRecord[]>
}

export class PublishedMediaReferenceReadStoreError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'QUERY_FAILED') {
    super(code)
    this.name = 'PublishedMediaReferenceReadStoreError'
  }
}

export type NormalizedPublishedMediaReferenceLookup = Readonly<{
  candidates: string[]
  limit: number
}>

export function normalizePublishedMediaReferenceLookup(
  candidates: readonly string[],
  limit: number,
): NormalizedPublishedMediaReferenceLookup {
  if (!Array.isArray(candidates) || candidates.length > 20) {
    throw new PublishedMediaReferenceReadStoreError('INVALID_INPUT')
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) {
    throw new PublishedMediaReferenceReadStoreError('INVALID_INPUT')
  }
  const normalized = [...new Set(candidates.map((candidate) => {
    if (
      typeof candidate !== 'string' ||
      candidate.trim().length === 0 ||
      candidate.length > 2048
    ) {
      throw new PublishedMediaReferenceReadStoreError('INVALID_INPUT')
    }
    return candidate.trim()
  }))]
  return { candidates: normalized, limit }
}

export interface PublishedMediaReferenceD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
    }
  }
}

/**
 * Production adapter. W03 remains on D1-02 until a separately approved
 * runtime cutover; this store preserves the existing D1 JSON1 lookup.
 */
export function createD1PublishedMediaReferenceReadStore(
  db: PublishedMediaReferenceD1Database,
): PublishedMediaReferenceReadStore {
  return {
    async listPublishedMediaReferences(rawCandidates, rawLimit) {
      const { candidates, limit } = normalizePublishedMediaReferenceLookup(rawCandidates, rawLimit)
      if (candidates.length === 0) return []
      const placeholders = candidates.map(() => '?').join(', ')
      const sql = [
        'SELECT id, owner_user_id, creator_id, content_type, access_mode',
        'FROM contents',
        "WHERE state = 'PUBLISHED'",
        '  AND (',
        '    body_ref IN (' + placeholders + ')',
        '    OR cover_ref IN (' + placeholders + ')',
        '    OR EXISTS (',
        '      SELECT 1',
        '      FROM json_each(contents.media_refs_json) AS media_ref',
        '      WHERE media_ref.value IN (' + placeholders + ')',
        '    )',
        '  )',
        'ORDER BY id ASC',
        'LIMIT ?',
      ].join('\n')
      try {
        const result = await db.prepare(sql)
          .bind(...candidates, ...candidates, ...candidates, limit)
          .all<PublishedMediaReferenceRecord>()
        return result.results ?? []
      } catch {
        throw new PublishedMediaReferenceReadStoreError('QUERY_FAILED')
      }
    },
  }
}
