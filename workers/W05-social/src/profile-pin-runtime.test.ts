/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { getProfilePin, isContentProfilePinned, pinProfileContent, unpinProfileContent } from './profile-pin-runtime.js'

const db = (firstResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args, meta: { changes: 1 } })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

const published = { id: 'content-1', content_type: 'post', state: 'PUBLISHED', owner_user_id: 'viewer-1' }
const pin = { user_id: 'viewer-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z' }

describe('profile pin runtime', () => {
  it('pins canonical published content for the owner without duplicating content', async () => {
    const d = db([published, pin])
    await expect(pinProfileContent(d, 'viewer-1', 'content-1')).resolves.toEqual({
      userId: 'viewer-1', contentId: 'content-1', pinnedAt: pin.pinned_at,
    })
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(String(prepare.mock.calls[1]?.[0])).toContain('ON CONFLICT(user_id) DO UPDATE')
    expect(String(prepare.mock.calls[1]?.[0])).toContain('social_profile_pins.content_id = excluded.content_id')
    expect(String(prepare.mock.calls[1]?.[0])).not.toContain('body')
  })

  it('rejects pins from non-owners and does not write', async () => {
    const d = db([{ ...published, owner_user_id: 'someone-else' }])
    await expect(pinProfileContent(d, 'viewer-1', 'content-1'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects missing, non-post, or unpublished content', async () => {
    await expect(pinProfileContent(db([{ ...published, content_type: 'article' }]), 'viewer-1', 'content-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(pinProfileContent(db([null]), 'viewer-1', 'content-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(pinProfileContent(db([{ ...published, state: 'DRAFT' }]), 'viewer-1', 'content-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('rejects invalid identifiers before querying the database', async () => {
    const d = db()
    await expect(pinProfileContent(d, 'viewer-1', 'content/1'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('unpins only the matching item for the authenticated owner and repeats safely', async () => {
    const d = db()
    await expect(unpinProfileContent(d, 'viewer-1', 'content-1')).resolves.toBeUndefined()
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(String(prepare.mock.calls[0]?.[0])).toContain('DELETE FROM social_profile_pins WHERE user_id = ? AND content_id = ?')
    expect(prepare.mock.calls[0]?.[0]).toContain('content_id')
  })

  it('reads only a published post pin that still belongs to the user', async () => {
    await expect(getProfilePin(db([pin]), 'viewer-1')).resolves.toEqual({
      userId: 'viewer-1', contentId: 'content-1', pinnedAt: pin.pinned_at,
    })
    await expect(getProfilePin(db([null]), 'viewer-1')).resolves.toBeNull()
  })

  it('reports a pin publicly only for published owner content', async () => {
    await expect(isContentProfilePinned(db([{ pinned: 1 }]), 'content-1')).resolves.toBe(true)
    await expect(isContentProfilePinned(db([{ pinned: 0 }]), 'content-1')).resolves.toBe(false)
  })
})
