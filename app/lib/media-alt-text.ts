import { apiRequest } from './api-client'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

/**
 * Read image descriptions only after W01 has checked the published reference
 * and W03 has authorized public/member visibility for the current viewer.
 * One composer post contains at most four media attachments.
 */
export async function fetchPublishedMediaAltText(
  urls: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const requestedUrls = [...new Set(urls.filter((url) => typeof url === 'string' && url.trim()))].slice(0, 4)
  if (requestedUrls.length === 0) return {}

  const query = new URLSearchParams()
  requestedUrls.forEach((url) => query.append('url', url))
  const result = await apiRequest<unknown>('/media/metadata?' + query.toString(), {
    method: 'GET',
    signal,
  })
  if (!result.response.ok) return {}

  const envelope = asRecord(result.data)
  const data = asRecord(envelope?.data)
  const items = Array.isArray(data?.items) ? data.items : []
  const requested = new Set(requestedUrls)
  const descriptions: Record<string, string> = {}
  for (const value of items) {
    const item = asRecord(value)
    const url = typeof item?.url === 'string' ? item.url : ''
    const alt = typeof item?.alt === 'string' ? item.alt.trim() : ''
    if (url && requested.has(url) && alt) descriptions[url] = alt
  }
  return descriptions
}
