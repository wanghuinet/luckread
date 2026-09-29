import { describe, expect, it } from 'vitest'

import { canTransitionContentState, decodeCursor, encodeCursor, isState } from './content-runtime.js'

describe('W03 content contract core', () => {
  it('accepts the canonical lifecycle vocabulary and cursor round-trip', () => {
    expect(isState('DRAFT')).toBe(true)
    expect(isState('APPROVED')).toBe(true)
    expect(isState('RESTORED')).toBe(true)
    expect(isState('REVIEW_PENDING')).toBe(false)

    const cursor = encodeCursor('2026-09-29T12:00:00.000Z', 'content_123')
    expect(decodeCursor(cursor)).toEqual({
      updatedAt: '2026-09-29T12:00:00.000Z',
      id: 'content_123',
    })
  })

  it('allows only the contracted creator and moderator transitions', () => {
    expect(canTransitionContentState('DRAFT', 'PENDING_REVIEW', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('PENDING_REVIEW', 'REJECTED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'material_edit_requires_review')).toBe(true)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'other')).toBe(false)
  })


  it('rejects invalid cursors and forbidden direct publication transitions', () => {
    expect(() => decodeCursor('not-a-valid-cursor')).toThrow()
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('DELETED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('ARCHIVED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
  })
})
