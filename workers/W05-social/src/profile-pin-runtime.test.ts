import { describe, expect, it, vi } from 'vitest'
import type { OwnedPostContext } from './owned-post-context.js'
import { getProfilePinReference, pinProfileContent, unpinProfileContent } from './profile-pin-runtime.js'
import { ProfilePinStoreError, type ProfilePinStorageRow, type ProfilePinStore } from './profile-pin-store.js'

const publishedContext: OwnedPostContext = {
  contentId: 'content-1', ownerUserId: 'viewer-1', contentType: 'post', state: 'PUBLISHED',
  updatedAt: '2026-10-20T00:00:00.000Z',
}

function memoryStore(seed: ProfilePinStorageRow[] = []): ProfilePinStore {
  const rows = new Map(seed.map(row => [row.user_id, row]))
  return {
    async pin(userId, contentId, pinnedAt) {
      const existing = rows.get(userId)
      const row = {
        user_id: userId,
        content_id: contentId,
        pinned_at: existing?.content_id === contentId ? existing.pinned_at : pinnedAt,
      }
      rows.set(userId, row)
      return row
    },
    async get(userId) { return rows.get(userId) ?? null },
    async unpin(userId, contentId) {
      if (rows.get(userId)?.content_id === contentId) rows.delete(userId)
    },
  }
}

const pin: ProfilePinStorageRow = {
  user_id: 'viewer-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z',
}

describe('profile pin runtime', () => {
  it('pins W03-verified owner content, preserves repeated timestamps and supports read/unpin', async () => {
    const store = memoryStore()
    const first = await pinProfileContent('viewer-1', 'content-1', publishedContext, store)
    const retry = await pinProfileContent('viewer-1', 'content-1', publishedContext, store)
    expect(first).toMatchObject({ userId: 'viewer-1', contentId: 'content-1' })
    expect(retry.pinnedAt).toBe(first.pinnedAt)
    expect(await getProfilePinReference('viewer-1', store)).toEqual(first)
    await unpinProfileContent('viewer-1', 'content-1', store)
    await expect(getProfilePinReference('viewer-1', store)).resolves.toBeNull()
  })

  it('rejects non-owner context before consulting the Store', async () => {
    const store: ProfilePinStore = { pin: vi.fn(), get: vi.fn(), unpin: vi.fn() }
    await expect(pinProfileContent('viewer-1', 'content-1', {
      ...publishedContext, ownerUserId: 'someone-else',
    }, store)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(store.pin).not.toHaveBeenCalled()
  })

  it('rejects missing, mismatched, non-post or unpublished context before writing', async () => {
    const store: ProfilePinStore = { pin: vi.fn(), get: vi.fn(), unpin: vi.fn() }
    const cases = [
      null,
      { ...publishedContext, contentId: 'other-content' },
      { ...publishedContext, contentType: 'article' },
      { ...publishedContext, state: 'DRAFT' },
      { ...publishedContext, state: 'UNPUBLISHED' },
    ]
    for (const context of cases) {
      await expect(pinProfileContent('viewer-1', 'content-1', context as never, store))
        .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    }
    expect(store.pin).not.toHaveBeenCalled()
  })

  it('validates identifiers before Store access', async () => {
    const store: ProfilePinStore = { pin: vi.fn(), get: vi.fn(), unpin: vi.fn() }
    await expect(pinProfileContent('viewer-1', 'content/1', publishedContext, store))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(store.pin).not.toHaveBeenCalled()
  })

  it('reads the pin reference and clears only a matching owner/content pair', async () => {
    const store = memoryStore([pin])
    await expect(getProfilePinReference('viewer-1', store)).resolves.toEqual({
      userId: 'viewer-1', contentId: 'content-1', pinnedAt: pin.pinned_at,
    })
    await unpinProfileContent('viewer-1', 'content-1', store)
    await expect(getProfilePinReference('viewer-1', store)).resolves.toBeNull()
  })

  it('maps persistence failures to a sanitized service error', async () => {
    const store: ProfilePinStore = {
      pin: vi.fn(async () => { throw new ProfilePinStoreError() }),
      get: vi.fn(), unpin: vi.fn(),
    }
    await expect(pinProfileContent('viewer-1', 'content-1', publishedContext, store))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
