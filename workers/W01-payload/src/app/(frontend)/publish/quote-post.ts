export type QuotePostTargetCandidate = {
  id?: unknown
  contentType?: unknown
  state?: unknown
  accessMode?: unknown
}

/**
 * A quote may reference only the exact, currently published public post.
 * W01 and W05 remain authoritative for write-time permission checks.
 */
export function isPublicQuotePostTarget(
  target: QuotePostTargetCandidate | null | undefined,
  expectedContentId: string,
): boolean {
  return Boolean(
    target &&
    expectedContentId.trim() &&
    target.id === expectedContentId &&
    target.contentType === 'post' &&
    target.state === 'PUBLISHED' &&
    target.accessMode === 'PUBLIC',
  )
}
