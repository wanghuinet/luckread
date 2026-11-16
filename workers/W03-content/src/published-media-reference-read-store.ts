export type PublishedMediaReferenceRecord = Readonly<{
  id: string
  owner_user_id: string
  creator_id: string | null
  content_type: 'article' | 'post' | 'video'
  access_mode: 'PUBLIC' | 'MEMBERS_ONLY'
}>

export type W03PublishedMediaReferenceRuntimeEnv = Readonly<{
  W03_CONTENT_READ_DRIVER?: string
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
