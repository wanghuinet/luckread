import { fetchJson } from './client-api.js'

type FollowRelationship = {
  following?: boolean
  relationship?: { blocked?: boolean; blockedBy?: boolean }
}
type ApiResponse<T> = { data?: T; error?: { message?: string } }
type Result = { response: Response; data: ApiResponse<FollowRelationship> }

const inFlight = new Map<string, Promise<Result>>()

/** Coalesce overlapping relationship reads for cards displaying the same author. */
export function getSharedFollowRelationship(authorId: string): Promise<Result> {
  const existing = inFlight.get(authorId)
  if (existing) return existing
  const request = fetchJson<ApiResponse<FollowRelationship>>(
    '/api/v1/social/follows/' + encodeURIComponent(authorId),
    { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store' },
  )
  const shared = request.finally(() => {
    if (inFlight.get(authorId) === shared) inFlight.delete(authorId)
  })
  inFlight.set(authorId, shared)
  return shared
}
