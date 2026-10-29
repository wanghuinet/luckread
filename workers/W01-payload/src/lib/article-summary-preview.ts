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
