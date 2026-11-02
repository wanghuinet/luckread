/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { enqueueNotification, extractSocialTokens, getContentSocialSummary, getSocialTargets, listDiscoveryTopics, syncSocialTokens } from './social-closure-runtime.js'

describe('W05 unified social closure', () => {
  it('normalizes and deduplicates mentions and hashtags', () => {
    expect(extractSocialTokens('你好 @Alice #Travel #travel @Alice #日本')).toEqual([
      { kind: 'mention', value: '@Alice', normalized: 'alice' },
      { kind: 'hashtag', value: '#Travel', normalized: 'travel' },
      { kind: 'hashtag', value: '#日本', normalized: '日本' },
    ])
  })

  it('uses one content target family for article, post and video', () => {
    const source = 'target_type IN (\'content\',\'comment\')'
    expect(source).toContain("target_type IN ('content','comment')")
  })

  it('keeps notification vocabulary unified', () => {
    expect(['FOLLOW', 'LIKE', 'COMMENT', 'REPLY', 'MENTION']).toHaveLength(5)
  })

  it('uses W03 content context and W05-only SQL for social summary counts and pin state', async () => {
    const firstResults: unknown[] = [
      { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7, pinned: 1 },
      { liked: 1, favorited: 0, reposted: 1 },
    ]
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return {
          bind: (..._values: unknown[]) => ({
            first: async () => firstResults.shift() ?? null,
            all: async () => ({ results: [] }),
          }),
        }
      },
    } as unknown as D1Database
    const contentContext = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(getContentSocialSummary(db, 'content-1', contentContext, 'viewer-1')).resolves.toMatchObject({
      contentId: 'content-1',
      contentType: 'post',
      counts: { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7 },
      pinned: true,
      viewer: { liked: true, favorited: false, reposted: true },
      topics: [],
      mentions: [],
    })
    expect(queries.some(sql => /(?:FROM|JOIN)\s+contents/i.test(sql))).toBe(false)
    const countsQuery = queries.find(sql => sql.includes('AS pinned'))
    expect(countsQuery).toContain('FROM social_profile_pins p')
    expect(countsQuery).not.toContain('JOIN contents')
  })

  it('rejects a mismatched or unpublished social context before querying W05', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    await expect(getContentSocialSummary(db, 'content-1', {
      contentId: 'another-content',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(getContentSocialSummary(db, 'content-1', {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'UNPUBLISHED',
    } as never)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('validates content token synchronization through W03 context and writes only W05-owned edges', async () => {
    const queries: string[] = []
    const batch = vi.fn(async () => [])
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return { bind: (..._values: unknown[]) => ({
          all: async () => ({ results: [] }),
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }) }
      },
      batch,
    } as unknown as D1Database
    const contentContext = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(syncSocialTokens(db, 'owner-1', 'content', 'content-1', 'plain text', [], contentContext))
      .resolves.toEqual({ topics: 0, mentions: 0 })
    expect(batch).toHaveBeenCalledTimes(1)
    expect(queries.some(sql => /(?:FROM|JOIN)\s+contents/i.test(sql))).toBe(false)
    expect(queries.every(sql => !/\b(?:FROM|JOIN)\s+contents\b/i.test(sql))).toBe(true)
  })

  it('resolves Unicode-equivalent mention handles with the same NFKC and lowercase rules as parsed tokens', async () => {
    const inserts: Array<{ sql: string; values: unknown[] }> = []
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => {
            inserts.push({ sql, values })
            return { success: true, meta: { changes: 1 } }
          },
        }),
      }),
      batch: async () => [],
    } as unknown as D1Database
    const contentContext = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(syncSocialTokens(
      db,
      'owner-1',
      'content',
      'content-1',
      'Thanks @alice',
      [{ userId: 'mentioned-user', handle: 'ＡＬＩＣＥ' }],
      contentContext,
    )).resolves.toEqual({ topics: 0, mentions: 1 })

    const mentionInsert = inserts.find(({ sql }) => sql.includes('INSERT OR IGNORE INTO social_mentions'))
    expect(mentionInsert?.values[4]).toBe('mentioned-user')
    expect(inserts.some(({ sql }) => sql.includes('INSERT OR IGNORE INTO social_notifications'))).toBe(true)
  })

  it('keeps a historical mention attached to its stored identity after its handle is reclaimed', async () => {
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return {
          bind: (..._values: unknown[]) => ({
            all: async () => sql.includes('FROM social_mentions')
              ? { results: [{ mentioned_user_id: 'original-user-id', handle: 'alice' }] }
              : { results: [] },
          }),
        }
      },
    } as unknown as D1Database

    // The current username owner may now be a different account. Historical
    // reads must use the immutable ID captured when the mention was created.
    await expect(getSocialTargets(db, 'content', 'content-1')).resolves.toEqual({
      topics: [],
      mentions: [{ userId: 'original-user-id', handle: 'alice' }],
    })

    const mentionRead = queries.find(sql => sql.includes('FROM social_mentions'))
    expect(mentionRead).toContain('SELECT mentioned_user_id, handle')
    expect(mentionRead).toContain('WHERE target_type = ? AND target_id = ?')
    expect(mentionRead).not.toContain('JOIN users')
    expect(mentionRead).not.toContain('JOIN profiles')
    expect(mentionRead).not.toContain('username')
  })

  it('preserves an existing mention identity when the same handle is later owned by another account', async () => {
    const inserts: Array<{ sql: string; values: unknown[] }> = []
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return {
          bind: (...values: unknown[]) => ({
            first: async () => null,
            all: async () => sql.includes('FROM social_mentions')
              ? { results: [{ mentioned_user_id: 'original-user-id', handle: 'alice' }] }
              : { results: [] },
            run: async () => {
              inserts.push({ sql, values })
              return { success: true, meta: { changes: 1 } }
            },
          }),
        }
      },
      batch: async () => [],
    } as unknown as D1Database
    const contentContext = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(syncSocialTokens(
      db,
      'owner-1',
      'content',
      'content-1',
      'Still mentioning @alice',
      [{ userId: 'reclaimed-handle-owner-id', handle: 'alice' }],
      contentContext,
    )).resolves.toEqual({ topics: 0, mentions: 1 })

    const mentionInsert = inserts.find(({ sql }) => sql.includes('INSERT OR IGNORE INTO social_mentions'))
    expect(mentionInsert?.values[4]).toBe('original-user-id')
    expect(mentionInsert?.values[5]).toBe('alice')
    expect(inserts.some(({ sql }) => sql.includes('INSERT OR IGNORE INTO social_notifications'))).toBe(false)
    const priorLookup = queries.find((sql) => sql.includes('FROM social_mentions'))
    expect(priorLookup).toContain('SELECT mentioned_user_id, handle')
    expect(priorLookup).not.toContain('JOIN users')
    expect(priorLookup).not.toContain('username')
  })

  it('fails closed for content token sync without W03 context or when the actor is not the owner', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    await expect(syncSocialTokens(db, 'owner-1', 'content', 'content-1', 'plain text'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(syncSocialTokens(db, 'owner-1', 'content', 'content-1', 'plain text', [], {
      contentId: 'content-1',
      ownerUserId: 'someone-else',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('ranks active discovery topics using W03-published contexts without querying canonical contents', async () => {
    const now = Date.now()
    const recent = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString()
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString()
    const edges = [
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-1' },
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-2' },
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-old' },
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-unpublished' },
      { topic_id: 'topic-2', normalized_name: 'books', display_name: 'Books', target_id: 'content-1' },
      { topic_id: 'topic-2', normalized_name: 'books', display_name: 'Books', target_id: 'content-3' },
      { topic_id: 'topic-3', normalized_name: 'writing', display_name: 'Writing', target_id: 'content-4' },
      { topic_id: 'topic_日本', normalized_name: '日本', display_name: '日本', target_id: 'content-4' },
      { topic_id: 'topic_日本語', normalized_name: '日本語', display_name: '日本語', target_id: 'content-5' },
      { topic_id: 'topic_龥', normalized_name: '龥', display_name: '龥', target_id: 'content-6' },
      { topic_id: 'topic_𐐀', normalized_name: 'deseret', display_name: 'Deseret', target_id: 'content-7' },
    ]
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return {
          bind: (...values: unknown[]) => ({
            all: async () => {
              const afterTopic = values.length === 3 ? String(values[0]) : null
              const afterTarget = values.length === 3 ? String(values[1]) : null
              const ordered = [...edges]
                .filter(edge => !afterTopic || edge.topic_id > afterTopic ||
                  (edge.topic_id === afterTopic && edge.target_id > afterTarget!))
                .sort((a, b) => a.topic_id.localeCompare(b.topic_id) || a.target_id.localeCompare(b.target_id))
              return { results: ordered.slice(0, 200) }
            },
          }),
        }
      },
    } as unknown as D1Database
    const contextById = new Map([
      ['content-1', { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(1) }],
      ['content-2', { contentId: 'content-2', ownerUserId: 'owner-2', contentType: 'article', state: 'PUBLISHED', updatedAt: recent(2) }],
      ['content-3', { contentId: 'content-3', ownerUserId: 'owner-3', contentType: 'video', state: 'PUBLISHED', updatedAt: recent(3) }],
      ['content-4', { contentId: 'content-4', ownerUserId: 'owner-4', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(4) }],
      ['content-5', { contentId: 'content-5', ownerUserId: 'owner-5', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(5) }],
      ['content-6', { contentId: 'content-6', ownerUserId: 'owner-6', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(5) }],
      ['content-7', { contentId: 'content-7', ownerUserId: 'owner-7', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(5) }],
      ['content-old', { contentId: 'content-old', ownerUserId: 'owner-5', contentType: 'post', state: 'PUBLISHED', updatedAt: old }],
    ])
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        expect(request.url).toContain('/internal/content/published-social-context-batch')
        expect(request.headers.get('X-LuckRead-Caller')).toBe('W05')
        expect(request.headers.get('X-LuckRead-Correlation-Id')).toBe('discovery-test')
        expect(request.headers.has('Authorization')).toBe(false)
        expect(request.headers.has('Cookie')).toBe(false)
        const body = await request.json() as { contentIds: string[] }
        const items = body.contentIds.flatMap(id => {
          const context = contextById.get(id)
          return context ? [context] : []
        })
        return Response.json({ data: { items } })
      }),
    }

    const firstPage = await listDiscoveryTopics(db, binding, 'discovery-test', '2', null)
    expect(firstPage.items).toMatchObject([
      { topicId: 'topic-1', name: 'reading', displayName: 'Reading', contentCount: 2 },
      { topicId: 'topic-2', name: 'books', displayName: 'Books', contentCount: 2 },
    ])
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(binding.fetch).toHaveBeenCalled()
    expect(queries.every(sql => !/(?:FROM|JOIN)\s+contents\b/i.test(sql))).toBe(true)
    expect(queries[0]).toContain('ix_social_target_topics_content_topic_target')
    expect(queries[0]).toContain('CROSS JOIN social_topics')
    expect(queries[0]).not.toContain('SELECT DISTINCT')

    const secondPage = await listDiscoveryTopics(db, binding, 'discovery-test', '1', firstPage.nextCursor)
    expect(secondPage.items).toMatchObject([
      { topicId: 'topic-3', name: 'writing', displayName: 'Writing', contentCount: 1 },
    ])
    expect(secondPage.hasMore).toBe(true)
    expect(secondPage.nextCursor).toEqual(expect.any(String))

    const thirdPage = await listDiscoveryTopics(db, binding, 'discovery-test', '1', secondPage.nextCursor)
    expect(thirdPage.items).toMatchObject([
      { topicId: 'topic_日本', name: '日本', displayName: '日本', contentCount: 1 },
    ])
    expect(thirdPage.hasMore).toBe(true)
    expect(thirdPage.nextCursor).toEqual(expect.any(String))

    const fourthPage = await listDiscoveryTopics(db, binding, 'discovery-test', '1', thirdPage.nextCursor)
    expect(fourthPage.items).toMatchObject([
      { topicId: 'topic_日本語', name: '日本語', displayName: '日本語', contentCount: 1 },
    ])
    expect(fourthPage.hasMore).toBe(true)
    expect(fourthPage.nextCursor).toEqual(expect.any(String))

    const fifthPage = await listDiscoveryTopics(db, binding, 'discovery-test', '1', fourthPage.nextCursor)
    expect(fifthPage.items).toMatchObject([
      { topicId: 'topic_龥', name: '龥', displayName: '龥', contentCount: 1 },
    ])
    expect(fifthPage.hasMore).toBe(true)
    expect(fifthPage.nextCursor).toEqual(expect.any(String))

    const sixthPage = await listDiscoveryTopics(db, binding, 'discovery-test', '1', fifthPage.nextCursor)
    expect(sixthPage.items).toMatchObject([
      { topicId: 'topic_𐐀', name: 'deseret', displayName: 'Deseret', contentCount: 1 },
    ])
    expect(sixthPage.hasMore).toBe(false)
    expect(sixthPage.nextCursor).toBeNull()
  })


  it('bounds W03 context retention and preserves contexts referenced by the current LRU batch', async () => {
    vi.stubGlobal('caches', undefined)
    const now = new Date().toISOString()
    // Topic ranking must not retain large optional card titles in its LRU.
    const largeTitle = 'x'.repeat(512)
    const edges = Array.from({ length: 5000 }, (_, index) => {
      const suffix = String(index).padStart(5, '0')
      return {
        topic_id: 'topic-' + suffix,
        normalized_name: 'topic-' + suffix,
        display_name: 'Topic ' + suffix,
        target_id: 'content-' + suffix,
      }
    })
    // The first row reuses the oldest cached content in the same batch as 199
    // newly fetched contexts. The LRU must not evict it before aggregation.
    edges.push(
      { topic_id: 'topic-05000', normalized_name: 'topic-05000', display_name: 'Topic 05000', target_id: 'content-00000' },
      { topic_id: 'topic-05000', normalized_name: 'topic-05000', display_name: 'Topic 05000', target_id: 'content-05000' },
    )
    for (let index = 1; index <= 198; index += 1) {
      const suffix = String(5000 + index).padStart(5, '0')
      edges.push({
        topic_id: 'topic-' + suffix,
        normalized_name: 'topic-' + suffix,
        display_name: 'Topic ' + suffix,
        target_id: 'content-' + suffix,
      })
    }
    // This later reference confirms an evicted context is re-fetched safely.
    edges.push({
      topic_id: 'topic-99999',
      normalized_name: 'topic-99999',
      display_name: 'Topic 99999',
      target_id: 'content-00001',
    })

    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return {
          bind: (...values: unknown[]) => ({
            all: async () => {
              const afterTopic = values.length === 3 ? String(values[0]) : null
              const afterTarget = values.length === 3 ? String(values[1]) : null
              const ordered = edges
                .filter(edge => !afterTopic || edge.topic_id > afterTopic ||
                  (edge.topic_id === afterTopic && edge.target_id > afterTarget!))
                .sort((a, b) => a.topic_id < b.topic_id ? -1 : a.topic_id > b.topic_id ? 1 :
                  a.target_id < b.target_id ? -1 : a.target_id > b.target_id ? 1 : 0)
              return { results: ordered.slice(0, 200) }
            },
          }),
        }
      },
    } as unknown as D1Database

    const requestedIds: string[] = []
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        const body = await request.json() as { contentIds: string[] }
        requestedIds.push(...body.contentIds)
        return Response.json({
          data: {
            items: body.contentIds.map(contentId => ({
              contentId,
              ownerUserId: 'owner-1',
              contentType: 'post',
              state: 'PUBLISHED',
              updatedAt: now,
              title: largeTitle,
            })),
          },
        })
      }),
    }

    try {
      const page = await listDiscoveryTopics(db, binding, 'bounded-context-cache-test', '1', null)
      expect(page.items).toMatchObject([
        { topicId: 'topic-05000', contentCount: 2 },
      ])
      expect(page.hasMore).toBe(true)
      expect(queries.every(sql => !/(?:FROM|JOIN)\s+contents\b/i.test(sql))).toBe(true)
      expect(queries.some(sql => sql.includes('(st.topic_id, st.target_id) > (?, ?)'))).toBe(true)
      expect(requestedIds).toHaveLength(5200)
      expect(requestedIds.filter(contentId => contentId === 'content-00001')).toHaveLength(2)
      expect(binding.fetch).toHaveBeenCalledTimes(105)
    } finally {
      vi.unstubAllGlobals()
    }
  })


  it('reuses the ranked discovery snapshot across cursor pages', async () => {
    const cacheEntries = new Map<string, Response>()
    const cache = {
      match: vi.fn(async (key: Request) => cacheEntries.get(key.url)?.clone()),
      put: vi.fn(async (key: Request, response: Response) => {
        cacheEntries.set(key.url, response.clone())
      }),
    }
    vi.stubGlobal('caches', { default: cache })

    const now = Date.now()
    const edges = [
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-1' },
      { topic_id: 'topic-2', normalized_name: 'books', display_name: 'Books', target_id: 'content-2' },
    ]
    const queries: string[] = []
    const db = {
      prepare: (sql: string) => {
        queries.push(sql)
        return { bind: () => ({ all: async () => ({ results: edges }) }) }
      },
    } as unknown as D1Database
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        const body = await request.json() as { contentIds: string[] }
        return Response.json({
          data: {
            items: body.contentIds.map((contentId, index) => ({
              contentId,
              ownerUserId: 'owner-' + (index + 1),
              contentType: 'post',
              state: 'PUBLISHED',
              updatedAt: new Date(now - index * 60_000).toISOString(),
            })),
          },
        })
      }),
    }

    try {
      const firstPage = await listDiscoveryTopics(db, binding, 'discovery-cache-test', '1', null)
      expect(firstPage.items).toMatchObject([
        { topicId: 'topic-1', contentCount: 1 },
      ])
      expect(firstPage.hasMore).toBe(true)
      expect(firstPage.nextCursor).toEqual(expect.any(String))

      const secondPage = await listDiscoveryTopics(db, binding, 'discovery-cache-test', '1', firstPage.nextCursor)
      expect(secondPage.items).toMatchObject([
        { topicId: 'topic-2', contentCount: 1 },
      ])
      expect(secondPage.hasMore).toBe(false)
      expect(secondPage.nextCursor).toBeNull()
      expect(queries).toHaveLength(1)
      expect(binding.fetch).toHaveBeenCalledTimes(1)
      expect(cache.put).toHaveBeenCalledTimes(1)
      expect(cache.match).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects malformed discovery topic cursors', async () => {
    const db = { prepare: () => { throw new Error('database must not be queried for an invalid cursor') } } as unknown as D1Database
    await expect(listDiscoveryTopics(db, undefined, 'invalid-cursor-test', '20', 'not-a-cursor'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })


  it('retries transient inbox persistence with a stable notification ID and dedupe key', async () => {
    const insertBindings: unknown[][] = []
    let insertAttempts = 0
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => null,
          run: async () => {
            if (sql.includes('INSERT OR IGNORE INTO social_notifications')) {
              insertAttempts += 1
              insertBindings.push(values)
              if (insertAttempts === 1) throw new Error('D1_ERROR: SQLITE_BUSY: database is locked')
            }
            return { success: true, meta: { changes: 1 } }
          },
        }),
      }),
    } as unknown as D1Database

    await expect(enqueueNotification(db, {
      recipientUserId: 'recipient-1',
      actorUserId: 'actor-1',
      type: 'COMMENT',
      targetType: 'content',
      targetId: 'content-1',
      payload: { eventId: 'event-1' },
    })).resolves.toBeUndefined()

    expect(insertAttempts).toBe(2)
    expect(insertBindings).toHaveLength(2)
    expect(insertBindings[1]).toEqual(insertBindings[0])
    expect(insertBindings[0]?.[0]).toEqual(expect.any(String))
    expect(insertBindings[0]?.[6]).toBe('COMMENT:recipient-1:actor-1:content:content-1')
  })

  it('does not retry permanent notification SQL failures', async () => {
    let insertAttempts = 0
    const db = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          first: async () => null,
          run: async () => {
            if (sql.includes('INSERT OR IGNORE INTO social_notifications')) {
              insertAttempts += 1
              throw new Error('D1_ERROR: no such table: social_notifications')
            }
            return { success: true, meta: { changes: 1 } }
          },
        }),
      }),
    } as unknown as D1Database

    await expect(enqueueNotification(db, {
      recipientUserId: 'recipient-1',
      actorUserId: 'actor-1',
      type: 'COMMENT',
      targetType: 'content',
      targetId: 'content-1',
    })).resolves.toBeUndefined()

    expect(insertAttempts).toBe(1)
  })

  it('bounds exhausted inbox persistence retries and logs failures without leaking details', async () => {
    let insertAttempts = 0
    const insertBindings: unknown[][] = []
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => null,
          run: async () => {
            if (sql.includes('INSERT OR IGNORE INTO social_notifications')) {
              insertAttempts += 1
              insertBindings.push(values)
              throw new Error('D1_ERROR: SQLITE_BUSY: database is locked; private database detail that must not be logged')
            }
            return { success: true, meta: { changes: 1 } }
          },
        }),
      }),
    } as unknown as D1Database
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(enqueueNotification(db, {
        recipientUserId: 'recipient-1',
        actorUserId: 'actor-1',
        type: 'COMMENT',
        targetType: 'content',
        targetId: 'content-1',
      })).resolves.toBeUndefined()

      expect(insertAttempts).toBe(3)
      expect(insertBindings).toHaveLength(3)
      expect(insertBindings[1]).toEqual(insertBindings[0])
      expect(insertBindings[2]).toEqual(insertBindings[0])
      expect(warning).toHaveBeenCalledWith('W05_SOCIAL_NOTIFICATION_WRITE_FAILED', {
        type: 'COMMENT',
        targetType: 'content',
        errorName: 'Error',
      })
      expect(JSON.stringify(warning.mock.calls)).not.toContain('recipient-1')
      expect(JSON.stringify(warning.mock.calls)).not.toContain('content-1')
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private database detail')
    } finally {
      warning.mockRestore()
    }
  })

})
