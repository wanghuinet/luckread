import { describe, expect, it } from 'vitest'

import { resolveCommentPagePagination } from '../../src/app/(frontend)/content/[contentId]/comment-pagination'

describe('resolveCommentPagePagination', () => {
  it('continues when the server returns a new cursor', () => {
    expect(resolveCommentPagePagination({
      requestedCursor: 'cursor-1',
      nextCursor: 'cursor-2',
      hasMore: true,
      requestedCursors: new Set(['cursor-1']),
    })).toEqual({ nextCursor: 'cursor-2', hasMore: true, repeatedCursor: false })
  })

  it('stops when the server repeats the cursor used for the current page', () => {
    expect(resolveCommentPagePagination({
      requestedCursor: 'cursor-1',
      nextCursor: 'cursor-1',
      hasMore: true,
      requestedCursors: new Set(['cursor-1']),
    })).toEqual({ nextCursor: null, hasMore: false, repeatedCursor: true })
  })

  it('stops when the server cycles back to any earlier cursor', () => {
    expect(resolveCommentPagePagination({
      requestedCursor: 'cursor-3',
      nextCursor: 'cursor-1',
      hasMore: true,
      requestedCursors: new Set(['cursor-1', 'cursor-2', 'cursor-3']),
    })).toEqual({ nextCursor: null, hasMore: false, repeatedCursor: true })
  })

  it('ends normally when the server reports no next page', () => {
    expect(resolveCommentPagePagination({
      requestedCursor: 'cursor-1',
      nextCursor: null,
      hasMore: false,
      requestedCursors: new Set(['cursor-1']),
    })).toEqual({ nextCursor: null, hasMore: false, repeatedCursor: false })
  })
})
