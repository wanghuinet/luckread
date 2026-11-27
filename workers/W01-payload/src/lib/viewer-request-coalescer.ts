import { fetchJson } from './client-api.js'

let inFlight: Promise<{ response: Response; data: { id?: string } | null }> | null = null

/** Coalesce simultaneous card-mounted viewer lookups; never cache identity after completion. */
export function getSharedViewerRequest(): Promise<{ response: Response; data: { id?: string } | null }> {
  if (inFlight) return inFlight
  const request = fetchJson<{ id?: string }>('/api/v1/users/me', {
    credentials: 'include',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  inFlight = request.finally(() => {
    if (inFlight === shared) inFlight = null
  })
  const shared = inFlight
  return shared
}
