import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import type { ContentContextReadStore } from './content-context-read-store-postgres.js'

const baseHeaders = {
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w03-context-test',
}

function fixture() {
  const store: ContentContextReadStore = {
    getPublishedContentAuthorContext: vi.fn(async () => ({
      contentId: 'post_1',
      ownerUserId: 'user_1',
    })),
    getOwnedPostContext: vi.fn(async () => ({
      contentId: 'post_1',
      ownerUserId: 'user_1',
      contentType: 'post',
      state: 'DRAFT',
      updatedAt: '2026-11-15T12:00:00.000Z',
    })),
    getPublishedContentSocialContext: vi.fn(async () => ({
      contentId: 'post_1',
      ownerUserId: 'user_1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-11-15T12:00:00.000Z',
    })),
    getPublishedContentSocialContexts: vi.fn(async () => [{
      contentId: 'post_1',
      ownerUserId: 'user_1',
      contentType: 'post',
      state: 'PUBLISHED',
      title: 'Published post',
      updatedAt: '2026-11-15T12:00:00.000Z',
    }]),
    getPublishedOwnerPostContext: vi.fn(async () => ({
      contentId: 'post_1',
      ownerUserId: 'user_1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-11-15T12:00:00.000Z',
    })),
  }
  const worker = createW03ContentWorker({
    contentContextReadStoreProvider: () => store,
  })
  const env = {
    D1_02: {
      prepare() {
        throw new Error('D1 must not be queried when a Neon context store is selected')
      },
      batch() {
        throw new Error('D1 must not be queried when a Neon context store is selected')
      },
    },
  }
  return { store, worker, env }
}

describe('W03 selected content-context read store routing', () => {
  it('routes the W05 single published social context through the selected store', async () => {
    const f = fixture()
    const response = await f.worker.fetch(new Request(
      'https://w03.internal/internal/content/contents/post_1/published-social-context',
      { headers: { ...baseHeaders, 'X-LuckRead-Caller': 'W05' } },
    ), f.env as never)

    expect(response.status).toBe(200)
    expect(f.store.getPublishedContentSocialContext).toHaveBeenCalledWith('post_1')
  })

  it('routes the W05 batch published social context through the selected store', async () => {
    const f = fixture()
    const response = await f.worker.fetch(new Request(
      'https://w03.internal/internal/content/published-social-context-batch',
      {
        method: 'POST',
        headers: { ...baseHeaders, 'X-LuckRead-Caller': 'W05', 'content-type': 'application/json' },
        body: JSON.stringify({ contentIds: ['post_1'] }),
      },
    ), f.env as never)

    expect(response.status).toBe(200)
    expect(f.store.getPublishedContentSocialContexts).toHaveBeenCalledWith(['post_1'])
  })

  it('routes the W05 public-post owner context through the selected store', async () => {
    const f = fixture()
    const response = await f.worker.fetch(new Request(
      'https://w03.internal/internal/content/contents/post_1/public-post-context/user_1',
      { headers: { ...baseHeaders, 'X-LuckRead-Caller': 'W05' } },
    ), f.env as never)

    expect(response.status).toBe(200)
    expect(f.store.getPublishedOwnerPostContext).toHaveBeenCalledWith('post_1', 'user_1')
  })

  it('routes the authenticated W05 owned-post context through the selected store', async () => {
    const f = fixture()
    const response = await f.worker.fetch(new Request(
      'https://w03.internal/internal/content/contents/post_1/owned-post-context',
      {
        headers: {
          ...baseHeaders,
          'X-LuckRead-Caller': 'W05',
          'X-LuckRead-Principal-User-Id': 'user_1',
          'X-LuckRead-Principal-Layer': 'L2',
        },
      },
    ), f.env as never)

    expect(response.status).toBe(200)
    expect(f.store.getOwnedPostContext).toHaveBeenCalledWith('post_1', 'user_1')
  })

  it('routes the W01 published author context through the selected store', async () => {
    const f = fixture()
    const response = await f.worker.fetch(new Request(
      'https://w03.internal/internal/content/contents/post_1/public-author-context',
      { headers: { ...baseHeaders, 'X-LuckRead-Caller': 'W01' } },
    ), f.env as never)

    expect(response.status).toBe(200)
    expect(f.store.getPublishedContentAuthorContext).toHaveBeenCalledWith('post_1')
  })
})
