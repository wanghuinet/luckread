import { describe, expect, it } from 'vitest'

import {
  assertContentTransitionActor,
  buildContentStatePatch,
  resolveContentTransition,
} from './content-state-machine'

describe('content state machine', () => {
  it('allows the canonical creator submission transition', () => {
    const transition = resolveContentTransition('DRAFT', 'PENDING_REVIEW')

    expect(transition.permission).toBe('content.submit_review.own')
    expect(transition.event).toBe('content.submitted')

    expect(() =>
      assertContentTransitionActor({
        transition,
        user: { id: 'u1' },
        authorId: 'u1',
      }),
    ).not.toThrow()
  })

  it('rejects forbidden lifecycle jumps', () => {
    expect(() => resolveContentTransition('DRAFT', 'PUBLISHED')).toThrow(/Forbidden content transition/)
    expect(() => resolveContentTransition('REJECTED', 'PUBLISHED')).toThrow(/Forbidden content transition/)
    expect(() => resolveContentTransition('ARCHIVED', 'PUBLISHED')).toThrow(/Forbidden content transition/)
  })

  it('requires moderator role for moderation decisions', () => {
    const transition = resolveContentTransition('PENDING_REVIEW', 'APPROVED')

    expect(() =>
      assertContentTransitionActor({
        transition,
        user: { id: 'u1', role: 'creator' },
        authorId: 'u2',
      }),
    ).toThrow(/Moderator permission required/)

    expect(() =>
      assertContentTransitionActor({
        transition,
        user: { id: 'u2', role: 'moderator' },
        authorId: 'u1',
      }),
    ).not.toThrow()
  })

  it('requires the content owner for creator transitions', () => {
    const transition = resolveContentTransition('APPROVED', 'PUBLISHED')

    expect(() =>
      assertContentTransitionActor({
        transition,
        user: { id: 'u2' },
        authorId: 'u1',
      }),
    ).toThrow(/Content ownership required/)
  })

  it('builds lifecycle timestamps from the target state', () => {
    expect(buildContentStatePatch('PUBLISHED', '2026-09-14T00:00:00.000Z')).toEqual({
      state: 'PUBLISHED',
      publishedAt: '2026-09-14T00:00:00.000Z',
    })
    expect(buildContentStatePatch('ARCHIVED', '2026-09-14T00:00:00.000Z')).toEqual({
      state: 'ARCHIVED',
      archivedAt: '2026-09-14T00:00:00.000Z',
    })
  })
})
