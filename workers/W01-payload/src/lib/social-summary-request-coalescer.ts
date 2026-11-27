import { fetchJson } from './client-api.js'

type SocialSummary = {
  data?: {
    counts?: { likes?: number; favorites?: number; comments?: number; shares?: number; reposts?: number }
    viewer?: { liked?: boolean; favorited?: boolean; reposted?: boolean } | null
    pinned?: boolean
  }
  error?: { message?: string }
}

type Result = { response: Response; data: SocialSummary }

const inFlight = new Map<string, Promise<Result>>()

/** Share overlapping social-summary reads for duplicate cards without caching resolved state. */
export function getSharedSocialSummary(contentId: string): Promise<Result> {
  const existing = inFlight.get(contentId)
  if (existing) return existing
  const request = fetchJson<SocialSummary>(
    '/api/v1/contents/' + encodeURIComponent(contentId) + '/social',
    { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store' },
  )
  const shared = request.finally(() => {
    if (inFlight.get(contentId) === shared) inFlight.delete(contentId)
  })
  inFlight.set(contentId, shared)
  return shared
}
