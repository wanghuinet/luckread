export type CommentPagePaginationInput = {
  requestedCursor: string | null
  nextCursor: string | null
  hasMore: boolean
  requestedCursors: ReadonlySet<string>
}

export type CommentPagePagination = {
  nextCursor: string | null
  hasMore: boolean
  repeatedCursor: boolean
}

/**
 * Prevent a malformed cursor response from keeping the comments "Load more"
 * control alive forever. The current request is included in requestedCursors
 * before this function is called, so a server echo of that cursor is a cycle.
 */
export function resolveCommentPagePagination({
  requestedCursor,
  nextCursor,
  hasMore,
  requestedCursors,
}: CommentPagePaginationInput): CommentPagePagination {
  const repeatedCursor = nextCursor !== null && (
    nextCursor === requestedCursor || requestedCursors.has(nextCursor)
  )

  return {
    nextCursor: repeatedCursor ? null : nextCursor,
    hasMore: hasMore && nextCursor !== null && !repeatedCursor,
    repeatedCursor,
  }
}
