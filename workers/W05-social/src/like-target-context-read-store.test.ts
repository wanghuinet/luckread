import { describe, expect, it, vi } from 'vitest'
import { createD1LikeTargetContextReadStore } from './like-target-context-read-store.js'
import type { LikeTargetContextD1QueryExecutor } from './like-target-context-read-store.js'

describe('D1 like target context read store', () => {
  it('reads only the W05 comment target fields by parameterized id', async () => {
    const first = vi.fn(async () => ({
      id: 'comment-1',
      state: 'PUBLISHED',
      author_user_id: 'author-1',
      content_id: 'content-1',
    }))
    const prepare = vi.fn((_sql: string) => ({ bind: vi.fn(() => ({ first })) }))
    const store = createD1LikeTargetContextReadStore({ prepare } as unknown as LikeTargetContextD1QueryExecutor)

    await expect(store.readCommentTarget('comment-1')).resolves.toMatchObject({
      id: 'comment-1',
      state: 'PUBLISHED',
      author_user_id: 'author-1',
      content_id: 'content-1',
    })
    expect(prepare.mock.calls[0]?.[0]).toContain('FROM social_comments')
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('checks both Block directions for all unique related users', async () => {
    const first = vi.fn(async () => ({ blocked: 1 }))
    const prepare = vi.fn((_sql: string) => ({ bind: vi.fn(() => ({ first })) }))
    const store = createD1LikeTargetContextReadStore({ prepare } as unknown as LikeTargetContextD1QueryExecutor)

    await expect(store.hasBidirectionalBlock('actor-1', [
      'author-1', 'parent-owner-1', 'author-1', 'actor-1',
    ])).resolves.toBe(true)
    expect(prepare.mock.calls[0]?.[0]).toContain('block.actor_user_id = ?')
    expect(prepare.mock.calls[0]?.[0]).toContain('block.target_user_id IN (?, ?)')
  })

  it('does not query when every related user is the actor', async () => {
    const prepare = vi.fn()
    const store = createD1LikeTargetContextReadStore({ prepare } as unknown as LikeTargetContextD1QueryExecutor)
    await expect(store.hasBidirectionalBlock('actor-1', ['actor-1', 'actor-1'])).resolves.toBe(false)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('sanitizes D1 read failures', async () => {
    const prepare = vi.fn(() => ({ bind: () => ({ first: async () => { throw new Error('sensitive SQL') } }) }))
    const store = createD1LikeTargetContextReadStore({ prepare } as unknown as LikeTargetContextD1QueryExecutor)
    await expect(store.readCommentTarget('comment-1')).rejects.toThrow('LIKE_TARGET_CONTEXT_READ_UNAVAILABLE')
  })
})
