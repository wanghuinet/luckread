import { plainTextFromArticleDocument, tryDeserializeArticleDocument } from './article-document.js'

export const ARTICLE_SUMMARY_MAX_CHARS = 180
export const ARTICLE_BODY_FETCH_MAX_BYTES = 40_000

/**
 * Build a plain-text excerpt from the existing article body format. The article
 * body remains authoritative in W03 and is still opened through the normal
 * content detail route; this helper only prepares a non-authoritative preview.
 */
export function extractArticleSummary(
  raw: string,
  maxChars = ARTICLE_SUMMARY_MAX_CHARS,
): string | null {
  if (!Number.isInteger(maxChars) || maxChars < 1) return null

  const document = tryDeserializeArticleDocument(raw)
  const source = document ? plainTextFromArticleDocument(document) : raw
  const normalized = source
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim()

  if (!normalized) return null
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, maxChars - 1).trimEnd() + '…'
}

/**
 * Body files are public media uploaded by LuckRead. Do not let a preview field
 * turn the feed into a fetch proxy for arbitrary third-party URLs.
 */
export function resolvePublicArticleBodyUrl(
  bodyRef: string,
  currentOrigin: string,
): string | null {
  try {
    const current = new URL(currentOrigin)
    const url = new URL(bodyRef, currentOrigin)
    if (url.username || url.password || url.hash) return null

    const localDevelopmentHost = ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname)
    const protocolAllowed = url.protocol === 'https:' ||
      (localDevelopmentHost && url.origin === current.origin && url.protocol === 'http:')
    if (!protocolAllowed) return null

    const sameOrigin = url.origin === current.origin
    const luckReadHost = url.hostname === 'luckread.com' || url.hostname.endsWith('.luckread.com')
    if (!sameOrigin && !luckReadHost) return null

    return url.toString()
  } catch {
    return null
  }
}

/**
 * Read a stored public content-body reference for server-side social token
 * extraction. The content service owns the reference, but it must still be
 * treated as data: allow only LuckRead URLs, never follow redirects, time-bound
 * the request, and cap bytes before decoding so malformed/oversized bodies
 * cannot become an unbounded outbound request or memory allocation.
 */
export async function readTrustedArticleBodyForSocialTokens(
  bodyRef: string,
  currentOrigin: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const url = resolvePublicArticleBodyUrl(bodyRef, currentOrigin)
  if (!url) return null

  let response: Response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { accept: 'text/plain' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    return null
  }

  if (!response.ok || response.status >= 300) {
    await response.body?.cancel().catch((): undefined => undefined)
    return null
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > ARTICLE_BODY_FETCH_MAX_BYTES) {
    await response.body?.cancel().catch((): undefined => undefined)
    return null
  }

  const reader = response.body?.getReader()
  if (!reader) return null

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > ARTICLE_BODY_FETCH_MAX_BYTES) {
        await reader.cancel().catch((): undefined => undefined)
        return null
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.trim() ? text : null
  } catch {
    await reader.cancel().catch((): undefined => undefined)
    return null
  } finally {
    reader.releaseLock()
  }
}
