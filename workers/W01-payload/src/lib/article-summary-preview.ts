import { plainTextFromArticleDocument, tryDeserializeArticleDocument } from './article-document.js'

export const ARTICLE_SUMMARY_MAX_CHARS = 180

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
  return normalized.slice(0, maxChars).trimEnd() + '…'
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
