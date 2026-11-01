import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { canTransitionContentState, ContentRuntimeError, createContent, createRequestId, deleteContent, decodeContentListCursor, decodeCursor, decodeScopedCursor, encodeContentListCursor, encodeCursor, encodeScopedCursor, isState, listContents, listPublishedContentsByIds, listContentRevisions, listCreatorContents, publishDueScheduledContent, publicContent, toErrorResponse, transitionContentState, updateContent, validateInput, validateListFilters } from './content-runtime.js'
import w03Worker, { hasCreatorContentPermission, hasSocialPostPermission, parseListLimit } from './index.js'

describe('W03 content contract core', () => {

  it('redacts member-only content titles and protected references when access is denied', () => {
    const result = publicContent({
      id: 'content_member_preview',
      creatorId: 'creator_1',
      state: 'PUBLISHED',
      scheduledAt: null,
      accessMode: 'MEMBERS_ONLY',
      accessGranted: false,
      version: 1,
      etag: 'W/"1"',
      slug: 'member-preview',
      title: 'This is the private full post body and must never appear in a preview.',
      bodyRef: 'https://img.luckread.com/private-body.txt',
      mediaRefs: ['https://img.luckread.com/private-photo.webp'],
      coverRef: 'https://img.luckread.com/private-cover.webp',
    } as never);

    expect(result).toMatchObject({
      accessMode: 'MEMBERS_ONLY',
      accessGranted: false,
      title: '会员专享内容',
      bodyRef: '',
      mediaRefs: [],
      coverRef: null,
    });
    expect(JSON.stringify(result)).not.toContain('private full post body');
  });

  it('classifies published public-post media and protects member-only media with W07 entitlement', async () => {
    const publicUrl = 'https://img.luckread.com/media/photo%20(1).png'
    const historicalUrl = 'https://cdn.luckread.com/media/photo%20(1).png'
    let query = ''
    let bindings: unknown[] = []
    let matchingRows: Array<Record<string, unknown>> = []
    const d1 = {
      prepare(sql: string) {
        query = sql
        return {
          bind(...values: unknown[]) {
            bindings = values
            return {
              all: async () => ({ results: matchingRows }),
            }
          },
        }
      },
    }
    let w07Calls = 0
    let w07Request: Request | null = null
    const env = {
      D1_02: d1,
      W07_SUBSCRIPTION: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          w07Calls += 1
          w07Request = input instanceof Request ? input : new Request(input, init)
          return Response.json({
            data: { allowed: true, reason: 'ACTIVE_CREATOR_MEMBERSHIP' },
            requestId: 'req_w07_test',
          })
        },
      },
    } as never
    const request = (
      mediaUrl: string,
      caller = 'W01',
      extraHeaders: Record<string, string> = {},
    ) => new Request(
      'https://luckread-w03.internal/internal/content/public-media-reference?url=' + encodeURIComponent(mediaUrl),
      {
        headers: {
          'X-LuckRead-Caller': caller,
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'public-media-reference-test',
          ...extraHeaders,
        },
      },
    )
    const publicPost = {
      id: 'post_public_1',
      owner_user_id: 'creator_user',
      creator_id: 'creator_1',
      content_type: 'post',
      access_mode: 'PUBLIC',
    }
    const memberPost = {
      id: 'post_member_1',
      owner_user_id: 'creator_user',
      creator_id: 'creator_1',
      content_type: 'post',
      access_mode: 'MEMBERS_ONLY',
    }

    matchingRows = [publicPost]
    const publicResponse = await w03Worker.fetch(request(publicUrl), env, {} as never)
    expect(publicResponse.status).toBe(200)
    await expect(publicResponse.json()).resolves.toMatchObject({
      data: { isPublic: true, isMemberContent: false, allowed: true },
    })
    expect(query).toContain("state = 'PUBLISHED'")
    expect(query).toContain('access_mode')
    expect(query).toContain('body_ref IN (')
    expect(query).toContain('cover_ref IN (')
    expect(query).toContain('json_each(contents.media_refs_json)')
    expect(query).toContain('media_ref.value IN (')
    const candidatesPerColumn = (query.match(/\?/g) ?? []).length / 3
    expect(candidatesPerColumn).toBe(1)
    expect(bindings.length).toBe(candidatesPerColumn * 3)
    expect(bindings[0]).toBe(publicUrl)
    expect(bindings[candidatesPerColumn]).toBe(publicUrl)
    expect(bindings[candidatesPerColumn * 2]).toBe(publicUrl)
    expect(bindings).not.toContain(historicalUrl)
    expect(w07Calls).toBe(0)

    matchingRows = [memberPost]
    const memberRequest = request(publicUrl, 'W01', {
      'X-LuckRead-Principal-User-Id': 'user_subscriber',
      'X-LuckRead-Principal-Layer': 'L2',
    })
    const memberResponse = await w03Worker.fetch(memberRequest, env, {} as never)
    expect(memberResponse.status).toBe(200)
    await expect(memberResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: true, allowed: true },
    })
    expect(w07Calls).toBe(1)
    expect(w07Request?.url).toContain('/internal/entitlements/check-creator-membership')
    expect(w07Request?.headers.get('X-LuckRead-Caller')).toBe('W03')
    expect(w07Request?.headers.get('X-LuckRead-Principal-User-Id')).toBe('user_subscriber')
    expect(w07Request?.headers.get('Cookie')).toBeNull()
    expect(await w07Request?.json()).toEqual({ creatorId: 'creator_1' })

    // Without a logged-in member, a member-only reference must not be exposed as public.
    w07Calls = 0
    const anonymousMemberResponse = await w03Worker.fetch(request(publicUrl), env, {} as never)
    expect(anonymousMemberResponse.status).toBe(200)
    await expect(anonymousMemberResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: true, allowed: false },
    })
    expect(w07Calls).toBe(0)

    // If a URL appears in both public and member-only content, membership wins:
    // it cannot become anonymous-public through the second reference.
    matchingRows = [publicPost, memberPost]
    const mixedReferenceResponse = await w03Worker.fetch(request(publicUrl), env, {} as never)
    await expect(mixedReferenceResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: true, allowed: false },
    })

    matchingRows = []
    const unpublishedResponse = await w03Worker.fetch(
      request('https://img.luckread.com/media/draft-only.png'),
      env,
      {} as never,
    )
    expect(unpublishedResponse.status).toBe(200)
    await expect(unpublishedResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: false, allowed: false },
    })

    const unsupportedHostResponse = await w03Worker.fetch(
      request('https://attacker.example/media/photo.png'),
      env,
      {} as never,
    )
    expect(unsupportedHostResponse.status).toBe(200)
    await expect(unsupportedHostResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: false, allowed: false },
    })

    const untrustedCaller = await w03Worker.fetch(request(publicUrl, 'W04'), env, {} as never)
    expect(untrustedCaller.status).toBe(403)

    const forwardedCredential = await w03Worker.fetch(
      request(publicUrl, 'W01', { Cookie: 'session=must-not-cross-service-boundary' }),
      env,
      {} as never,
    )
    expect(forwardedCredential.status).toBe(403)
  })
  it('strips member-only body and media on denial and fails closed when W07 is unavailable', async () => {
    const contentRow = {
      id: 'content_member_1',
      content_type: 'article',
      owner_user_id: 'creator_user',
      creator_id: 'creator_1',
      ip_id: null,
      state: 'PUBLISHED',
      scheduled_at: null,
      access_mode: 'MEMBERS_ONLY',
      version: 1,
      revision: 1,
      slug: 'member-article',
      title: 'Members-only title',
      body_ref: 'https://luckread.com/private-body',
      media_refs_json: JSON.stringify(['https://img.luckread.com/private-image.webp']),
      cover_ref: 'https://img.luckread.com/private-cover.webp',
      etag: 'W/"1"',
      created_at: '2026-10-29T00:00:00.000Z',
      updated_at: '2026-10-29T00:00:00.000Z',
    };
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({ ...contentRow }),
            };
          },
        };
      },
    };
    let providerStatus = 200;
    let allowed = false;
    let reasonOverride: string | null = null;
    let providerCalls = 0;
    const allowLimiter = { limit: async () => ({ success: true }) };
    const env = {
      D1_02: db,
      W07_SUBSCRIPTION: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          providerCalls += 1;
          const forwarded = input instanceof Request ? input : new Request(input, init);
          expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W03');
          expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('reader_user');
          expect(await forwarded.json()).toEqual({ creatorId: 'creator_1' });
          return Response.json({
            data: { allowed, reason: reasonOverride ?? (allowed ? 'ACTIVE_CREATOR_MEMBERSHIP' : 'MEMBERSHIP_REQUIRED') },
            requestId: 'req-membership-test',
          }, { status: providerStatus });
        },
      },
      CONTENT_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      CONTENT_PUBLIC_READ_LIMITER: allowLimiter,
      CONTENT_MUTATION_LIMITER: allowLimiter,
    } as never;
    const makeRequest = () => new Request('https://luckread-w03.internal/internal/content/contents/content_member_1', {
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'content-membership-check',
        'X-LuckRead-Principal-User-Id': 'reader_user',
        'X-LuckRead-Principal-Layer': 'L2',
      },
    });

    const denied = await w03Worker.fetch(makeRequest(), env, {} as never);
    expect(denied.status).toBe(200);
    await expect(denied.json()).resolves.toMatchObject({
      id: 'content_member_1',
      creatorId: 'creator_1',
      accessMode: 'MEMBERS_ONLY',
      accessGranted: false,
      title: '会员专享内容',
      bodyRef: '',
      mediaRefs: [],
      coverRef: null,
    });
    expect(providerCalls).toBe(1);

    allowed = true;
    const entitled = await w03Worker.fetch(makeRequest(), env, {} as never);
    expect(entitled.status).toBe(200);
    await expect(entitled.json()).resolves.toMatchObject({
      creatorId: 'creator_1',
      accessMode: 'MEMBERS_ONLY',
      accessGranted: true,
      bodyRef: 'https://luckread.com/private-body',
      mediaRefs: ['https://img.luckread.com/private-image.webp'],
      coverRef: 'https://img.luckread.com/private-cover.webp',
    });
    expect(providerCalls).toBe(2);

    reasonOverride = 'MEMBERSHIP_REQUIRED';
    const contradictory = await w03Worker.fetch(makeRequest(), env, {} as never);
    expect(contradictory.status).toBe(503);
    await expect(contradictory.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(providerCalls).toBe(3);

    reasonOverride = null;
    providerStatus = 503;
    const unavailable = await w03Worker.fetch(makeRequest(), env, {} as never);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(providerCalls).toBe(4);
  });

  it('does not let a public content record expose bytes also referenced by another membership-only record', async () => {
    const bodyRef = 'https://img.luckread.com/users/owner/luckread-article-11111111-2222-4333-8444-555555555555.json'
    const publicContentRow = {
      id: 'content_public_1',
      content_type: 'article',
      owner_user_id: 'public_owner',
      creator_id: 'public_creator',
      ip_id: null,
      state: 'PUBLISHED',
      scheduled_at: null,
      access_mode: 'PUBLIC',
      version: 1,
      revision: 1,
      slug: 'public-article',
      title: 'Public shell',
      body_ref: bodyRef,
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-29T00:00:00.000Z',
      updated_at: '2026-10-29T00:00:00.000Z',
    }
    const memberReferenceRows = [
      { owner_user_id: 'private_owner', creator_id: 'private_creator' },
    ]
    const queries: string[] = []
    const db = {
      prepare(sql: string) {
        queries.push(sql)
        return {
          bind() {
            return {
              first: async () => ({ ...publicContentRow }),
              all: async () => ({ results: memberReferenceRows.map((row) => ({ ...row })) }),
            }
          },
        }
      },
    }
    let allowed = false
    let entitlementChecks = 0
    const allowLimiter = { limit: async () => ({ success: true }) }
    const env = {
      D1_02: db,
      W07_SUBSCRIPTION: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          entitlementChecks += 1
          const forwarded = input instanceof Request ? input : new Request(input, init)
          expect(forwarded.url).toContain('/internal/entitlements/check-creator-membership')
          expect(await forwarded.json()).toEqual({ creatorId: 'private_creator' })
          return Response.json({
            data: {
              allowed,
              reason: allowed ? 'ACTIVE_CREATOR_MEMBERSHIP' : 'MEMBERSHIP_REQUIRED',
            },
            requestId: 'req-shared-body-test',
          })
        },
      },
      CONTENT_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      CONTENT_PUBLIC_READ_LIMITER: allowLimiter,
      CONTENT_MUTATION_LIMITER: allowLimiter,
    } as never
    const makeRequest = () => new Request(
      'https://luckread-w03.internal/internal/content/contents/content_public_1?bodyContext=1',
      {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'shared-body-reference-test',
          'X-LuckRead-Principal-User-Id': 'reader_user',
          'X-LuckRead-Principal-Layer': 'L2',
        },
      },
    )

    const denied = await w03Worker.fetch(makeRequest(), env, {} as never)
    expect(denied.status).toBe(200)
    await expect(denied.json()).resolves.toMatchObject({
      contentId: 'content_public_1',
      accessMode: 'PUBLIC',
      accessGranted: false,
      bodyRef: '',
    })
    expect(entitlementChecks).toBe(1)
    expect(queries.some((sql) =>
      sql.includes("state = 'PUBLISHED' AND access_mode = 'MEMBERS_ONLY'"),
    )).toBe(true)
    expect(queries.some((sql) =>
      sql.includes("access_mode = 'MEMBERS_ONLY'") && !sql.includes("state = 'PUBLISHED'"),
    )).toBe(false)

    allowed = true
    const entitled = await w03Worker.fetch(makeRequest(), env, {} as never)
    expect(entitled.status).toBe(200)
    await expect(entitled.json()).resolves.toMatchObject({
      contentId: 'content_public_1',
      accessMode: 'PUBLIC',
      accessGranted: true,
      bodyRef,
    })
    expect(entitlementChecks).toBe(2)
  })

  it('serves bookmarked contents only through authenticated W01 transport', async () => {
    const row = {
      id: 'content_1', content_type: 'post', owner_user_id: 'user_1', creator_id: 'user_1',
      ip_id: null, state: 'PUBLISHED', scheduled_at: null, version: 1, revision: 1,
      slug: 'post-1', title: 'Post 1', body_ref: 'body_1', media_refs_json: '[]',
      cover_ref: null, etag: 'W/"1"', created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    }
    let query = ''
    const env = {
      D1_02: {
        prepare(value: string) {
          query = value
          return { bind: () => ({ all: async () => ({ results: [row] }) }) }
        },
      },
    } as never
    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/bookmarked-items', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'bookmark-list',
          'X-LuckRead-Principal-User-Id': 'user_1',
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ids: ['content_1'] }),
      }),
      env,
      {} as never,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'content_1', title: 'Post 1' }] },
    })
    expect(query).toContain("WHERE c.state = 'PUBLISHED'")
    const denied = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/bookmarked-items', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'untrusted',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'blocked',
        },
        body: JSON.stringify({ ids: ['content_1'] }),
      }),
      env,
      {} as never,
    )
    expect(denied.status).toBe(403)
  })


  it('serves owner-scoped owned-post context only over the W05 internal binding', async () => {
    let query = ''
    let bindings: unknown[] = []
    const row = {
      id: 'content_1',
      owner_user_id: 'user_1',
      content_type: 'post',
      state: 'DRAFT',
      updated_at: '2026-10-20T00:00:00.000Z',
    }
    const env = {
      D1_02: {
        prepare(sql: string) {
          query = sql
          return { bind: (...values: unknown[]) => {
            bindings = values
            return { first: async () => row }
          } }
        },
      },
    } as never
    const request = (caller: string, userId = 'user_1') => new Request(
      'https://luckread-w03.internal/internal/content/contents/content_1/owned-post-context',
      {
        headers: {
          'X-LuckRead-Caller': caller,
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'owned-post-context-test',
          'X-LuckRead-Principal-User-Id': userId,
          'X-LuckRead-Principal-Layer': 'L2',
        },
      },
    )
    const response = await w03Worker.fetch(request('W05'), env, {} as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        contentId: 'content_1',
        ownerUserId: 'user_1',
        contentType: 'post',
        state: 'DRAFT',
      },
    })
    expect(query).toContain('owner_user_id = ?')
    expect(query).toContain("content_type = 'post'")
    expect(bindings).toEqual(['content_1', 'user_1'])
    const denied = await w03Worker.fetch(request('W01'), env, {} as never)
    expect(denied.status).toBe(403)
    expect(query).toContain('owner_user_id = ?')
  })

  it('serves public profile-pin context only for the matching published post owner', async () => {
    let query = ''
    let bindings: unknown[] = []
    const row = {
      id: 'content_1',
      owner_user_id: 'user_1',
      content_type: 'post',
      state: 'PUBLISHED',
      updated_at: '2026-10-20T00:00:00.000Z',
    }
    const env = {
      D1_02: {
        prepare(sql: string) {
          query = sql
          return { bind: (...values: unknown[]) => {
            bindings = values
            return { first: async () => values[1] === 'user_1' ? row : null }
          } }
        },
      },
    } as never
    const request = (ownerUserId = 'user_1', caller = 'W05', extraHeaders: Record<string, string> = {}) =>
      new Request(
        `https://luckread-w03.internal/internal/content/contents/content_1/public-post-context/${ownerUserId}`,
        {
          headers: {
            'X-LuckRead-Caller': caller,
            'X-LuckRead-Transport-Version': '1.0',
            'X-LuckRead-Correlation-Id': 'public-profile-pin-context',
            ...extraHeaders,
          },
        },
      )

    const response = await w03Worker.fetch(request(), env, {} as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { contentId: 'content_1', ownerUserId: 'user_1', contentType: 'post', state: 'PUBLISHED' },
    })
    expect(query).toContain('owner_user_id = ?')
    expect(query).toContain("content_type = 'post'")
    expect(query).toContain("state = 'PUBLISHED'")
    expect(bindings).toEqual(['content_1', 'user_1'])

    const wrongOwner = await w03Worker.fetch(request('user_2'), env, {} as never)
    expect(wrongOwner.status).toBe(404)
    const wrongCaller = await w03Worker.fetch(request('user_1', 'W01'), env, {} as never)
    expect(wrongCaller.status).toBe(403)
    const forwardedCredentials = await w03Worker.fetch(
      request('user_1', 'W05', { Authorization: 'Bearer should-not-be-forwarded' }),
      env,
      {} as never,
    )
    expect(forwardedCredentials.status).toBe(403)
  })

  it('serves only minimal published content social context through the W05 internal binding', async () => {
    let query = ''
    let bindings: unknown[] = []
    const row = {
      id: 'content_1',
      owner_user_id: 'owner_1',
      content_type: 'article',
      state: 'PUBLISHED',
      updated_at: '2026-10-17T04:00:00.000Z',
    }
    const env = {
      D1_02: {
        prepare(sql: string) {
          query = sql
          return { bind: (...values: unknown[]) => {
            bindings = values
            return { first: async () => values[0] === 'missing_content' ? null : row }
          } }
        },
      },
    } as never
    const request = (caller = 'W05', extraHeaders: Record<string, string> = {}, contentId = 'content_1') =>
      new Request(
        `https://luckread-w03.internal/internal/content/contents/${contentId}/published-social-context`,
        {
          headers: {
            'X-LuckRead-Caller': caller,
            'X-LuckRead-Transport-Version': '1.0',
            'X-LuckRead-Correlation-Id': 'published-social-context-test',
            ...extraHeaders,
          },
        },
      )
    const response = await w03Worker.fetch(request(), env, {} as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { contentId: 'content_1', ownerUserId: 'owner_1', contentType: 'article', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' },
    })
    expect(query).toContain("state = 'PUBLISHED'")
    expect(query).toContain('updated_at')
    expect(bindings).toEqual(['content_1'])

    expect((await w03Worker.fetch(request('W01'), env, {} as never)).status).toBe(403)
    expect((await w03Worker.fetch(request('W05', { Authorization: 'Bearer not-forwarded' }), env, {} as never)).status).toBe(403)
    expect((await w03Worker.fetch(request('W05', {}, 'missing_content'), env, {} as never)).status).toBe(404)
  })

  it('serves a bounded batch of published social contexts only through the W05 internal transport', async () => {
    const rows = [
      { id: 'content_1', owner_user_id: 'owner_1', content_type: 'post', title: '第一篇', updated_at: '2026-10-17T04:00:00.000Z' },
      { id: 'content_2', owner_user_id: 'owner_2', content_type: 'article', title: '第二篇', updated_at: '2026-10-18T04:00:00.000Z' },
    ]
    let query = ''
    let bindings: unknown[] = []
    const env = {
      D1_02: {
        prepare(sql: string) {
          query = sql
          return {
            bind(...values: unknown[]) {
              bindings = values
              return { all: async () => ({ results: rows.filter(row => values.includes(row.id)) }) }
            },
          }
        },
      },
    } as never
    const request = (caller = 'W05', headers: Record<string, string> = {}) => new Request(
      'https://luckread-w03.internal/internal/content/published-social-context-batch',
      {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': caller,
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'context-batch-test',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ contentIds: ['content_1', 'content_2'] }),
      },
    )
    const response = await w03Worker.fetch(request(), env, {} as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [
        { contentId: 'content_1', ownerUserId: 'owner_1', contentType: 'post', state: 'PUBLISHED', title: '第一篇', updatedAt: '2026-10-17T04:00:00.000Z' },
        { contentId: 'content_2', ownerUserId: 'owner_2', contentType: 'article', state: 'PUBLISHED', title: '第二篇', updatedAt: '2026-10-18T04:00:00.000Z' },
      ] },
    })
    expect(query).toContain("state = 'PUBLISHED'")
    expect(query).toContain('id IN (?, ?)')
    expect(query).toContain('title')
    expect(bindings).toEqual(['content_1', 'content_2'])
    expect((await w03Worker.fetch(request('W01'), env, {} as never)).status).toBe(403)
    expect((await w03Worker.fetch(request('W05', { Cookie: 'must-not-be-forwarded' }), env, {} as never)).status).toBe(403)
  })

  it('loads a bounded list of published content IDs in bookmark order', async () => {
    const rows = [
      {
        id: 'content_2', content_type: 'post', owner_user_id: 'user_2', creator_id: 'user_2',
        ip_id: null, state: 'PUBLISHED', scheduled_at: null, version: 1, revision: 1,
        slug: 'post-2', title: 'Post 2', body_ref: 'body_2', media_refs_json: '[]',
        cover_ref: null, etag: 'W/"1"', created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'content_1', content_type: 'article', owner_user_id: 'user_1', creator_id: 'user_1',
        ip_id: null, state: 'PUBLISHED', scheduled_at: null, version: 1, revision: 1,
        slug: 'article-1', title: 'Article 1', body_ref: 'body_1', media_refs_json: '[]',
        cover_ref: null, etag: 'W/"1"', created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
      },
    ]
    let query = ''
    let bindings: unknown[] = []
    const db = {
      prepare(value: string) {
        query = value
        return { bind: (...values: unknown[]) => {
          bindings = values
          return { all: async () => ({ results: rows }) }
        } }
      },
    } as never

    const items = await listPublishedContentsByIds(db, ['content_2', 'content_1'])
    expect(items.map(item => item.id)).toEqual(['content_2', 'content_1'])
    expect(query).toContain('json_each(?)')
    expect(query).toContain("WHERE c.state = 'PUBLISHED'")
    expect(query).toContain('ORDER BY CAST(requested.key AS INTEGER) ASC')
    expect(bindings).toEqual([JSON.stringify(['content_2', 'content_1']), 2])
    await expect(listPublishedContentsByIds(db, Array.from({ length: 51 }, (_, i) => 'content_' + i)))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })


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

  it('emits contract-compliant error envelopes and request identifiers', async () => {
    const response = toErrorResponse(new ContentRuntimeError('VALIDATION_FAILED', 400))
    expect(response.status).toBe(422)
    const payload = await response.json() as {
      error: { code: string; message: string; details: Record<string, unknown> }
      requestId: string
    }
    expect(payload).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: expect.any(String), details: {} },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]+$/),
    })
    expect(createRequestId()).toMatch(/^req_[A-Za-z0-9_-]+$/)
  })

  it('binds public content cursors to filters and rejects cross-filter reuse', () => {
    const cursor = encodeContentListCursor(
      '2026-10-02T12:00:00.000Z',
      'content_123',
      'user_123',
      'video',
    )
    expect(decodeContentListCursor(cursor, 'user_123', 'video')).toMatchObject({
      createdAt: '2026-10-02T12:00:00.000Z',
      id: 'content_123',
      creatorId: 'user_123',
      contentType: 'video',
      version: 1,
    })
    const mismatchedCreator = (() => {
      try {
        decodeContentListCursor(cursor, null, 'video')
        return null
      } catch (error) {
        return error
      }
    })()
    const mismatchedType = (() => {
      try {
        decodeContentListCursor(cursor, 'user_123', 'article')
        return null
      } catch (error) {
        return error
      }
    })()
    expect(mismatchedCreator).toMatchObject({ code: 'INVALID_CURSOR' })
    expect(mismatchedType).toMatchObject({ code: 'INVALID_CURSOR' })
  })

  it('binds creator content pagination to owner and active filters', async () => {
    const row = {
      id: 'content_video_123',
      content_type: 'video',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      version: 1,
      revision: 1,
      slug: 'video-123',
      title: 'Draft video',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z',
      updated_at: '2026-10-02T12:01:00.000Z',
    }
    let prepareCalls = 0
    const db = {
      prepare() {
        prepareCalls += 1
        return { bind: () => ({ all: async () => ({ results: [row, { ...row, id: 'content_video_124' }] }) }) }
      },
    } as never
    const first = await listCreatorContents(db, 'user_123', null, 1, {
      status: 'DRAFT',
      contentType: 'video',
    })
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(() => decodeScopedCursor(
      first.nextCursor!,
      JSON.stringify({ type: 'creator-contents', ownerUserId: 'user_123', status: 'DRAFT', contentType: 'article' }),
    )).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }))
    await expect(listCreatorContents(db, 'user_123', first.nextCursor, 1, {
      status: 'DRAFT',
      contentType: 'article',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listCreatorContents(db, 'user_999', first.nextCursor, 1, {
      status: 'DRAFT',
      contentType: 'video',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(prepareCalls).toBe(1)
    const direct = encodeScopedCursor('2026-10-02T12:00:00.000Z', 'content_123', 'scope-a')
    expect(decodeScopedCursor(direct, 'scope-a')).toEqual({
      updatedAt: '2026-10-02T12:00:00.000Z',
      id: 'content_123',
    })
    expect(() => decodeScopedCursor(direct, 'scope-b')).toThrow(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    )
  })

  it('binds revision cursors to the owning user and content', async () => {
    const row = {
      id: 'revision_2',
      content_id: 'content_123',
      revision: 2,
      content_version: 2,
      actor_user_id: 'user_123',
      source_revision: 1,
      operation: 'UPDATE',
      state: 'DRAFT',
      slug: 'article-123',
      title: 'Revision title',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"2"',
      reason: null,
      correlation_id: 'test-correlation',
      created_at: '2026-10-02T12:01:00.000Z',
    }
    let prepareCalls = 0
    const db = {
      prepare() {
        prepareCalls += 1
        return { bind: () => ({ all: async () => ({ results: [row, { ...row, id: 'revision_1' }] }) }) }
      },
    } as never
    const first = await listContentRevisions(db, 'user_123', 'content_123', null, 1)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toEqual(expect.any(String))
    await expect(listContentRevisions(db, 'user_123', 'content_999', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    await expect(listContentRevisions(db, 'user_999', 'content_123', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(prepareCalls).toBe(1)
  })

  it('rejects update requests that change the immutable content type', async () => {
    const row = {
      id: 'content_type_guard_123',
      content_type: 'article',
      owner_user_id: 'user_type_guard',
      creator_id: 'user_type_guard',
      ip_id: null,
      state: 'DRAFT',
      version: 1,
      revision: 1,
      slug: 'original-slug',
      title: 'Original article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-07T12:00:00.000Z',
      updated_at: '2026-10-07T12:00:00.000Z',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    let prepareCount = 0
    const db = {
      prepare() {
        prepareCount += 1
        return {
          bind: () => ({
            first: async () => row,
          }),
        }
      },
    } as never

    await expect(
      updateContent(
        db,
        'user_type_guard',
        'content_type_guard_123',
        {
          contentType: 'video',
          title: 'Attempted type change',
          bodyRef: 'https://cdn.example.com/video-body.txt',
          mediaRefs: ['https://cdn.example.com/video.mp4'],
          coverRef: null,
        },
        'W/"1"',
        'content-type-guard-idem',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(prepareCount).toBe(1)
  })

  it('allows only the contracted creator and moderator transitions', () => {
    expect(canTransitionContentState('DRAFT', 'PENDING_REVIEW', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true, undefined, 'article')).toBe(false)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true, undefined, 'post')).toBe(true)
    expect(canTransitionContentState('DRAFT', 'PENDING_REVIEW', 'SOCIAL_AUTHOR', true, undefined, 'post')).toBe(false)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'SOCIAL_AUTHOR', true, undefined, 'post')).toBe(true)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'SOCIAL_AUTHOR', false, undefined, 'post')).toBe(false)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'SOCIAL_AUTHOR', true, undefined, 'video')).toBe(false)
    expect(canTransitionContentState('PUBLISHED', 'UNPUBLISHED', 'SOCIAL_AUTHOR', true, undefined, 'post')).toBe(true)
    expect(canTransitionContentState('UNPUBLISHED', 'DRAFT', 'SOCIAL_AUTHOR', true, undefined, 'post')).toBe(true)
    expect(canTransitionContentState('PUBLISHED', 'DRAFT', 'SOCIAL_AUTHOR', true, undefined, 'post')).toBe(false)
    expect(canTransitionContentState('PUBLISHED', 'UNPUBLISHED', 'SOCIAL_AUTHOR', false, undefined, 'post')).toBe(false)
    expect(canTransitionContentState('PUBLISHED', 'UNPUBLISHED', 'SOCIAL_AUTHOR', true, undefined, 'article')).toBe(false)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('PENDING_REVIEW', 'REJECTED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('APPROVED', 'SCHEDULED', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('SCHEDULED', 'DRAFT', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('SCHEDULED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'material_edit_requires_review')).toBe(true)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'other')).toBe(false)
  })

  it('allows ordinary social posts for authenticated L2+ layers without granting creator-content authority', () => {
    for (const layer of ['L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']) {
      expect(hasSocialPostPermission(layer)).toBe(true)
    }
    for (const layer of ['L0', 'L1', 'L9', '']) {
      expect(hasSocialPostPermission(layer)).toBe(false)
    }
    expect(hasCreatorContentPermission('L2')).toBe(false)
    expect(hasCreatorContentPermission('L3')).toBe(true)
    expect(hasCreatorContentPermission('L4')).toBe(true)
    expect(hasCreatorContentPermission('L5')).toBe(false)
    expect(hasCreatorContentPermission('L7')).toBe(false)
    expect(hasCreatorContentPermission('L8')).toBe(false)
  })


  it('does not let social-only layers mutate or delete a canonical non-post item', async () => {
    const row = {
      id: 'content_article_guard_1',
      content_type: 'article',
      owner_user_id: 'user_article_guard_1',
      creator_id: 'user_article_guard_1',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      version: 1,
      revision: 1,
      slug: 'article-guard-1',
      title: 'Article draft',
      body_ref: 'https://cdn.example.com/article-body.json',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-16T00:00:00.000Z',
      updated_at: '2026-10-16T00:00:00.000Z',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    const db = {
      prepare() {
        return { bind: () => ({ first: async () => row }) }
      },
      batch: async () => { throw new Error('a denied mutation must not write') },
    } as never

    for (const layer of ['L2', 'L5', 'L6', 'L7', 'L8']) {
      await expect(
        updateContent(
          db,
          'user_article_guard_1',
          'content_article_guard_1',
          { contentType: 'post', title: 'Spoofed type', bodyRef: 'https://cdn.example.com/body.txt', mediaRefs: [], coverRef: null },
          'W/"1"',
          'spoof-type-key-' + layer,
          new Date('2026-10-16T00:01:00.000Z'),
          'test',
          layer,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })

      await expect(
        deleteContent(
          db,
          'user_article_guard_1',
          'content_article_guard_1',
          'W/"1"',
          'delete-article-key-' + layer,
          new Date('2026-10-16T00:01:00.000Z'),
          layer,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    }
  })


  it('requires W03 preflight before a draft social post can transition directly to published', async () => {
    const row = {
      id: 'content_post_direct_1',
      content_type: 'post',
      owner_user_id: 'user_post_direct_1',
      creator_id: 'user_post_direct_1',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      version: 1,
      revision: 1,
      slug: 'post-direct-1',
      title: 'A short post',
      body_ref: 'https://cdn.example.com/post-body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-16T00:00:00.000Z',
      updated_at: '2026-10-16T00:00:00.000Z',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    const db = {
      prepare() {
        return { bind: () => ({ first: async () => row }) }
      },
      batch: async () => { throw new Error('preflight failures must happen before a state write') },
    } as never

    for (const layer of ['L2', 'L5', 'L6', 'L7', 'L8']) {
      await expect(
        transitionContentState(
          db,
          'user_post_direct_1',
          layer,
          'content_post_direct_1',
          'PUBLISHED',
          undefined,
          'W/"1"',
          'direct-post-idem-' + layer,
          new Date('2026-10-16T00:01:00.000Z'),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    }
  })



  it('allows higher global layers to publish only their own ordinary posts with preflight', async () => {
    for (const layer of ['L5', 'L6', 'L7', 'L8']) {
      const row = {
        id: 'content_high_layer_post_' + layer,
        content_type: 'post',
        owner_user_id: 'user_high_layer_' + layer,
        creator_id: 'user_high_layer_' + layer,
        ip_id: null,
        state: 'DRAFT',
        scheduled_at: null,
        version: 1,
        revision: 1,
        slug: 'high-layer-post-' + layer.toLowerCase(),
        title: 'A useful update',
        body_ref: 'https://cdn.example.com/post-body.txt',
        media_refs_json: '[]',
        cover_ref: null,
        etag: 'W/"1"',
        created_at: '2026-10-16T00:00:00.000Z',
        updated_at: '2026-10-16T00:00:00.000Z',
        idem_id: null,
        idem_owner_user_id: null,
        idem_request_hash: null,
        idem_status: null,
        idem_response_status: null,
        idem_response_json: null,
        idem_expires_at: null,
      }
      let batchCalled = false
      const db = {
        prepare() {
          return { bind: () => ({ first: async () => row }) }
        },
        batch: async () => { batchCalled = true; return [] },
      } as never

      const result = await transitionContentState(
        db,
        'user_high_layer_' + layer,
        layer,
        row.id,
        'PUBLISHED',
        undefined,
        'W/"1"',
        'publish-high-layer-' + layer,
        new Date('2026-10-16T00:01:00.000Z'),
        {
          preflight: {
            contentType: 'post',
            title: 'A useful update',
            body: 'I am sharing a useful update from our recent work and a few lessons learned along the way.',
            mediaRefs: [],
            coverRef: null,
            aiMode: 'none',
            humanContribution: 'substantial',
          },
        },
      )

      expect(result).toMatchObject({ from: 'DRAFT', to: 'PUBLISHED', version: 2, etag: 'W/"2"' })
      expect(batchCalled).toBe(true)
    }
  })

  it('requires the current verified creator identity to publish member-only posts', async () => {
    const row = {
      id: 'content_member_publish_1',
      content_type: 'post',
      owner_user_id: 'user_member_creator',
      creator_id: 'creator_verified_1',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      access_mode: 'MEMBERS_ONLY',
      version: 1,
      revision: 1,
      slug: 'member-post-1',
      title: 'Member-only update',
      body_ref: 'https://img.luckread.com/media/member-body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-16T00:00:00.000Z',
      updated_at: '2026-10-16T00:00:00.000Z',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    let batchCalls = 0
    const db = {
      prepare() {
        return { bind: () => ({ first: async () => row }) }
      },
      batch: async () => { batchCalls += 1; return [] },
    } as never
    const options = {
      preflight: {
        contentType: 'post',
        title: 'Member-only update',
        body: 'An update available to current members of this creator.',
        mediaRefs: [],
        coverRef: null,
        aiMode: 'none',
        humanContribution: 'substantial',
      },
    }
    const transition = (verifiedCreatorId?: string) => transitionContentState(
      db,
      'user_member_creator',
      'L3',
      row.id,
      'PUBLISHED',
      undefined,
      row.etag,
      'member-publish-' + (verifiedCreatorId ?? 'missing'),
      new Date('2026-10-16T00:01:00.000Z'),
      { ...options, verifiedCreatorId },
    )

    await expect(transition()).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    await expect(transition('creator_other')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(batchCalls).toBe(0)

    const published = await transition('creator_verified_1')
    expect(published).toMatchObject({ from: 'DRAFT', to: 'PUBLISHED', version: 2 })
    expect(batchCalls).toBe(1)
  })

  it('does not let a higher-layer social author publish an article', async () => {
    const row = {
      id: 'content_high_layer_article',
      content_type: 'article',
      owner_user_id: 'user_high_layer',
      creator_id: 'user_high_layer',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      version: 1,
      revision: 1,
      slug: 'high-layer-article',
      title: 'Article draft',
      body_ref: 'https://cdn.example.com/article-body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-16T00:00:00.000Z',
      updated_at: '2026-10-16T00:00:00.000Z',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    const db = {
      prepare() { return { bind: () => ({ first: async () => row }) } },
      batch: async () => { throw new Error('a denied article transition must not write') },
    } as never

    await expect(transitionContentState(
      db,
      'user_high_layer',
      'L7',
      row.id,
      'PUBLISHED',
      undefined,
      'W/"1"',
      'publish-high-layer-article',
      new Date('2026-10-16T00:01:00.000Z'),
      {
        preflight: {
          contentType: 'article',
          title: 'Article draft',
          body: 'An article body that should remain on the creator-only review lifecycle.',
          mediaRefs: [],
          coverRef: null,
        },
      },
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
  })

  it('requires a future timestamp before scheduling an approved content item', async () => {
    const db = {
      prepare() {
        throw new Error('database should not be reached for invalid scheduledAt')
      },
    } as never

    await expect(
      transitionContentState(
        db,
        'user_schedule',
        'L3',
        'content_schedule_123',
        'SCHEDULED',
        undefined,
        'W/"1"',
        'schedule-idem',
        new Date('2026-10-08T12:00:00.000Z'),
        { scheduledAt: '2026-10-08T11:59:59.000Z' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('publishes only due scheduled rows and converges concurrent execution safely', async () => {
    const statements: Array<{ query: string; bindings: unknown[] }> = []
    const dueRows = [
      { id: 'scheduled_due_1', version: 4, scheduled_at: '2026-10-08T12:00:00.000Z' },
      { id: 'scheduled_due_2', version: 7, scheduled_at: '2026-10-08T12:01:00.000Z' },
    ]
    const db = {
      prepare(query: string) {
        if (query.includes('FROM contents')) {
          return {
            bind: (...bindings: unknown[]) => ({
              all: async () => ({ results: dueRows }),
              first: async () => undefined,
              bindings,
            }),
          }
        }
        return {
          bind: (...bindings: unknown[]) => {
            statements.push({ query, bindings })
            return { query, bindings }
          },
        }
      },
      batch: async (items: Array<{ query: string }>) => items.map(() => ({ meta: { changes: 1 } })),
    } as never

    await expect(
      publishDueScheduledContent(db, new Date('2026-10-08T12:02:00.000Z'), 50),
    ).resolves.toEqual({ scanned: 2, published: 2 })

    expect(statements).toHaveLength(2)
    expect(statements[0]?.query).toContain("SET state = 'PUBLISHED', scheduled_at = NULL")
    expect(statements[0]?.query).toContain("WHERE id = ? AND state = 'SCHEDULED'")
    expect(statements[0]?.bindings).toEqual([
      5,
      'W/"5"',
      '2026-10-08T12:02:00.000Z',
      'scheduled_due_1',
      '2026-10-08T12:00:00.000Z',
      4,
    ])
  })

  it('requires at least one media reference for video content', () => {
    expect(() =>
      validateInput({
        contentType: 'video',
        title: 'Video without media',
        bodyRef: 'https://cdn.example.com/body.txt',
        mediaRefs: [],
      }),
    ).toThrow()

    expect(validateInput({
      contentType: 'video',
      title: 'Video with media',
      bodyRef: 'https://cdn.example.com/body.txt',
      mediaRefs: ['https://cdn.example.com/video.mp4'],
    }).contentType).toBe('video')
  })

  it('rejects malformed and out-of-range public pagination limits', () => {
    expect(parseListLimit(null)).toBe(20)
    expect(parseListLimit('1')).toBe(1)
    expect(parseListLimit('50')).toBe(50)
    expect(() => parseListLimit('0')).toThrow()
    expect(() => parseListLimit('51')).toThrow()
    expect(() => parseListLimit('1.5')).toThrow()
    expect(() => parseListLimit('abc')).toThrow()
  })

  it('rejects invalid public content pagination at the worker boundary', async () => {
    const db = {
      prepare() {
        throw new Error('database should not be reached for invalid pagination')
      },
    } as never

    for (const limit of ['0', '51', '1.5', 'abc']) {
      const response = await w03Worker.fetch(
        new Request('https://luckread-w03.internal/internal/content/contents?limit=' + limit, {
          headers: {
            'X-LuckRead-Caller': 'W01',
            'X-LuckRead-Transport-Version': '1.0',
            'X-LuckRead-Correlation-Id': 'test-correlation-' + limit,
          },
        }),
        { D1_02: db },
      )

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
        requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]+$/),
      })
    }
  })


  it('returns the canonical error envelope for an unmatched internal route', async () => {
    const db = {
      prepare() {
        throw new Error('database should not be reached for an unmatched route')
      },
    } as never
    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/unmatched-route', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-unmatched-route',
        },
      }),
      { D1_02: db },
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'NOT_FOUND', message: expect.any(String), details: {} },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]+$/),
    })
  })

  it('filters public content by content type', async () => {
    const preparedQueries: string[] = []
    const row = {
      id: 'content_video_123',
      content_type: 'video',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 1,
      revision: 1,
      title: 'Published video',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z',
      updated_at: '2026-10-02T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        preparedQueries.push(query)
        return {
          bind: () => ({
            all: async () => ({ results: [row] }),
          }),
        }
      },
    } as never

    const page = await listContents(db, null, 20, null, 'video')

    expect(page.items[0]?.contentType).toBe('video')
    expect(preparedQueries[0]).toContain("WHERE state = 'PUBLISHED' AND content_type = ?")
  })

  it('allows an L4 principal to complete an owned content state transition', async () => {
    const content = {
      id: 'content_l4_123',
      content_type: 'article',
      owner_user_id: 'user_l4_123',
      creator_id: 'user_l4_123',
      ip_id: null,
      state: 'APPROVED',
      version: 1,
      revision: 1,
      slug: 'l4-content-123',
      title: 'L4 owned article',
      body_ref: 'https://cdn.example.com/body.json',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-08T12:00:00.000Z',
      updated_at: '2026-10-08T12:00:00.000Z',
    }
    const db = {
      prepare() {
        return { bind: () => ({ first: async () => content }) }
      },
      batch: async () => [],
    } as never

    await expect(transitionContentState(
      db,
      'user_l4_123',
      'L4',
      'content_l4_123',
      'PUBLISHED',
      undefined,
      'W/"1"',
      'l4-publish-idem',
      new Date('2026-10-08T12:01:00.000Z'),
    )).resolves.toMatchObject({
      from: 'APPROVED',
      to: 'PUBLISHED',
      version: 2,
      etag: 'W/"2"',
    })
  })

  it('allows creator content operations only for L3-L4 layers', () => {
    expect(hasCreatorContentPermission('L3')).toBe(true)
    expect(hasCreatorContentPermission('L4')).toBe(true)
    expect(hasCreatorContentPermission('L5')).toBe(false)
    expect(hasCreatorContentPermission('L6')).toBe(false)
    expect(hasCreatorContentPermission('L7')).toBe(false)
    expect(hasCreatorContentPermission('L8')).toBe(false)
    expect(hasCreatorContentPermission('L2')).toBe(false)
    expect(hasCreatorContentPermission('')).toBe(false)
    expect(hasCreatorContentPermission('creator')).toBe(false)
  })

  it('validates creator content list filters', () => {
    expect(validateListFilters('DRAFT', 'video')).toEqual({ status: 'DRAFT', contentType: 'video' })
    expect(validateListFilters(null, null)).toEqual({})
    expect(() => validateListFilters('UNKNOWN', null)).toThrow()
    expect(() => validateListFilters(null, 'audio')).toThrow()
  })

  it('rejects invalid cursors and forbidden direct publication transitions', () => {
    expect(() => decodeCursor('not-a-valid-cursor')).toThrow()
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('DELETED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('ARCHIVED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('DELETED', 'RESTORED', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('RESTORED', 'DRAFT', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('RESTORED', 'PENDING_REVIEW', 'CREATOR', true)).toBe(false)
  })

  it('keeps the D1 batch fail-closed CAS guard on every content mutation', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )

    for (const functionName of [
      'createContent',
      'updateContent',
      'deleteContent',
      'transitionContentState',
      'applyModerationContentTransition',
    ]) {
      const start = runtime.indexOf('export async function ' + functionName)
      expect(start).toBeGreaterThanOrEqual(0)
      const end = runtime.indexOf('\nexport ', start + 10)
      const section = runtime.slice(start, end >= 0 ? end : runtime.length)
      expect(section).toContain('await batchMutation(db, [')
      expect(section).toContain('atomicGuard(db)')
    }

    expect(runtime).toContain('INSERT OR REPLACE INTO content_txn_guard')
    expect(runtime).toContain('VALUES (1, changes())')
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0001_content_core.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_txn_guard')
    expect(migration).toContain('successful INTEGER NOT NULL CHECK (successful = 1)')
  })

  it('returns media references from the public listing query', async () => {
    const preparedQueries: string[] = []
    const row = {
      id: 'content_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 2,
      revision: 2,
      title: 'Published article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '["https://cdn.example.com/image.jpg"]',
      cover_ref: 'https://cdn.example.com/image.jpg',
      etag: 'W/"2"',
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        preparedQueries.push(query)
        return {
          bind: () => ({
            all: async () => ({ results: [row] }),
          }),
        }
      },
    } as never

    const page = await listContents(db, null, 20)

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.mediaRefs).toEqual(['https://cdn.example.com/image.jpg'])
    expect(preparedQueries[0]).toContain('media_refs_json')
    expect(preparedQueries[0]).toContain('cover_ref')
  })



  it('filters public content by creator while keeping only published rows', async () => {
    const preparedQueries: string[] = []
    const row = {
      id: 'creator_content_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 1,
      revision: 1,
      title: 'Creator article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z',
      updated_at: '2026-10-02T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        preparedQueries.push(query)
        return {
          bind: () => ({
            all: async () => ({ results: [row] }),
          }),
        }
      },
    } as never

    const page = await listContents(db, null, 6, 'user_123')

    expect(page.items[0]?.creatorId).toBe('user_123')
    expect(preparedQueries[0]).toContain("WHERE state = 'PUBLISHED' AND creator_id = ?")
  })

  it('serves published content detail without a creator principal', async () => {
    const row = {
      id: 'content_public_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 2,
      revision: 2,
      title: 'Public article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"2"',
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        expect(query).toContain("AND (state = 'PUBLISHED' OR owner_user_id = ?)")
        return {
          bind: () => ({
            first: async () => row,
          }),
        }
      },
    } as never

    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_public_123', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-public',
        },
      }),
      { D1_02: db },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: 'content_public_123',
      creatorId: 'user_123',
      state: 'PUBLISHED',
      title: 'Public article',
    })
  })

  it('resolves a published content request by stable slug in one D1 read', async () => {
    const slug = '中文文章-1234567890abcdef1234567890abcdef'
    const row = {
      id: 'content_slug_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 3,
      revision: 3,
      slug,
      title: '中文文章',
      body_ref: 'https://cdn.example.com/body.json',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"3"',
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-03T12:01:00.000Z',
    }
    const queries: string[] = []
    const db = {
      prepare(query: string) {
        queries.push(query)
        return {
          bind: (...bindings: unknown[]) => ({
            first: async () => {
              expect(bindings).toEqual([slug, slug, ''])
              return row
            },
          }),
        }
      },
    } as never

    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/' + encodeURIComponent(slug), {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-slug',
        },
      }),
      { D1_02: db },
    )

    expect(response.status).toBe(200)
    expect(queries[0]).toContain('WHERE (id = ? OR slug = ?)')
    await expect(response.json()).resolves.toMatchObject({
      id: row.id,
      slug,
      title: row.title,
    })
  })

  it('does not expose non-published content to an anonymous detail request', async () => {
    const db = {
      prepare(query: string) {
        expect(query).toContain("AND (state = 'PUBLISHED' OR owner_user_id = ?)")
        return {
          bind: () => ({
            first: async () => undefined,
          }),
        }
      },
    } as never

    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_private_123', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-private',
        },
      }),
      { D1_02: db },
    )

    expect(response.status).toBe(404)
  })

})

  it('stores the full ContentRecord for update idempotency replay', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )
    const start = runtime.indexOf('export async function updateContent')
    const end = runtime.indexOf('\nexport async function deleteContent', start)
    const section = runtime.slice(start, end)
    expect(section).toContain('const idempotencyResponseBody = JSON.stringify(updated)')
    expect(section).toContain(
      'insertCompletedIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 200, idempotencyResponseBody, updatedAt, expiresAt),',
    )
    expect(section).toContain('return updated')
  })




describe('1.1 content revision history', () => {
  it('defines immutable revision persistence with the required audit fields', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0004_content_revision_history.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_revisions')
    expect(migration).toContain('UNIQUE(content_id, revision)')
    expect(migration).toContain('actor_user_id TEXT NOT NULL')
    expect(migration).toContain('source_revision INTEGER')
    expect(migration).toContain('correlation_id TEXT NOT NULL')
    expect(migration).toContain('CREATE INDEX content_revisions_content_created_idx')
    expect(migration).toContain('legacy_backfill')
  })

  it('defines scheduled publication persistence and trigger wiring', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0011_content_scheduled_publish.sql'),
      'utf8',
    )
    expect(migration).toContain('ALTER TABLE contents ADD COLUMN scheduled_at TEXT')
    expect(migration).toContain('CREATE INDEX contents_scheduled_due_idx')
    const wrangler = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/wrangler.jsonc'),
      'utf8',
    )
    expect(wrangler).toContain('"crons": ["* * * * *"]')
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/index.ts'),
      'utf8',
    )
    expect(runtime).toContain('async scheduled(controller: ScheduledController, env: Env)')
    expect(runtime).toContain('publishDueScheduledContent')
  })

  it('defines the stable slug migration and trigger payload', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0005_content_stable_slug.sql'),
      'utf8',
    )
    expect(migration).toContain('ALTER TABLE contents ADD COLUMN slug TEXT NOT NULL DEFAULT')
    expect(migration).toContain('CREATE UNIQUE INDEX contents_slug_unique_idx')
    expect(migration).toContain('ALTER TABLE content_revisions ADD COLUMN slug TEXT NOT NULL DEFAULT')
    expect(migration).toContain("'slug'")
    expect(migration).toContain('content.created')
  })

  it('keeps the rollback transport path under the revision contract', () => {
    const index = readFileSync(resolve(process.cwd(), 'workers/W03-content/src/index.ts'), 'utf8')
    const w01Detail = readFileSync(resolve(process.cwd(), 'workers/W01-payload/src/app/api/v1/contents/[contentId]/revisions/[revisionId]/route.ts'), 'utf8')
    const w01Rollback = readFileSync(resolve(process.cwd(), 'workers/W01-payload/src/app/api/v1/contents/[contentId]/revisions/[revisionId]/rollback/route.ts'), 'utf8')
    expect(index).toContain('rollbackContentRevision')
    expect(index).toContain('path.rollback')
    expect(w01Detail).toContain('export async function GET')
    expect(w01Detail).not.toContain("export async function POST")
    expect(w01Rollback).toContain("pathname: '/internal/content/contents/' + encodeURIComponent(contentId) + '/revisions/' + encodeURIComponent(revisionId) + '/rollback'")
    expect(w01Rollback).toContain('resolveVerifiedContentCreatorId(request, principal)')
    expect(w01Rollback).toContain('verifiedCreatorId,')
    expect(index).toContain("request.headers.get('X-LuckRead-Verified-Creator-Id')?.trim() || undefined")
  })

  it('records create, update and rollback history after the authoritative CAS guard', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )
    for (const operation of ["operation: 'CREATE'", "operation: 'UPDATE'", "operation: 'ROLLBACK'"]) {
      expect(runtime).toContain(operation)
    }
    expect(runtime).toContain("'content.revision.rolled_back'")
    for (const marker of ['export async function listContentRevisions', 'export async function getContentRevision', 'export async function rollbackContentRevision']) {
      expect(runtime).toContain(marker)
    }

    const updateIndex = runtime.indexOf('UPDATE contents')
    const updateGuard = runtime.indexOf('atomicGuard(db)', updateIndex)
    const updateRevision = runtime.indexOf("operation: 'UPDATE'", updateIndex)
    expect(updateIndex).toBeGreaterThanOrEqual(0)
    expect(updateGuard).toBeGreaterThan(updateIndex)
    expect(updateRevision).toBeGreaterThan(updateGuard)

    const rollbackIndex = runtime.indexOf('export async function rollbackContentRevision')
    expect(runtime.indexOf('UPDATE contents', rollbackIndex)).toBeGreaterThanOrEqual(rollbackIndex)
    expect(runtime.indexOf("operation: 'ROLLBACK'", rollbackIndex)).toBeGreaterThan(
      runtime.indexOf('atomicGuard(db)', rollbackIndex),
    )
    expect(runtime).toContain("sourceAccessMode !== currentAccessMode")
    expect(runtime).toContain("verifiedCreatorId !== content.creatorId")
  })
})


it('maps an authoritative D1 CAS guard failure to HTTP 412', async () => {
  const row = {
    id: 'content_cas_412_123',
    content_type: 'article',
    owner_user_id: 'user_cas_412',
    creator_id: 'user_cas_412',
    ip_id: null,
    state: 'DRAFT',
    version: 2,
    revision: 2,
    slug: 'cas-412',
    title: 'CAS guard test',
    body_ref: 'https://cdn.example.com/body.txt',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"2"',
    created_at: '2026-10-07T12:00:00.000Z',
    updated_at: '2026-10-07T12:01:00.000Z',
    idem_id: null,
    idem_owner_user_id: null,
    idem_request_hash: null,
    idem_status: null,
    idem_response_status: null,
    idem_response_json: null,
    idem_expires_at: null,
  }
  const db = {
    prepare() {
      return { bind: (...bindings: unknown[]) => ({ first: async () => { expect(bindings).toContain('content_cas_412_123'); return row } }) }
    },
    batch: async () => { throw new Error('CHECK constraint failed: successful') },
  } as never
  await expect(updateContent(
    db,
    'user_cas_412',
    'content_cas_412_123',
    { contentType: 'article', title: 'Updated title', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"2"',
    'content-cas-412-idem',
  )).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
})

it('does not misclassify unrelated UNIQUE violations as idempotency conflicts', async () => {
  const row = {
    id: 'content_unique_123',
    content_type: 'article',
    owner_user_id: 'user_unique',
    creator_id: 'user_unique',
    ip_id: null,
    state: 'DRAFT',
    version: 1,
    revision: 1,
    slug: 'unique-test',
    title: 'Unique test',
    body_ref: 'https://cdn.example.com/body.txt',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"1"',
    created_at: '2026-10-07T12:00:00.000Z',
    updated_at: '2026-10-07T12:00:00.000Z',
    idem_id: null,
    idem_owner_user_id: null,
    idem_request_hash: null,
    idem_status: null,
    idem_response_status: null,
    idem_response_json: null,
    idem_expires_at: null,
  }
  const db = {
    prepare() {
      return { bind: (...bindings: unknown[]) => ({ first: async () => { expect(bindings).toContain('content_unique_123'); return row } }) }
    },
    batch: async () => { throw new Error('UNIQUE constraint failed: contents.body_ref') },
  } as never
  await expect(updateContent(
    db,
    'user_unique',
    'content_unique_123',
    { contentType: 'article', title: 'Updated title', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"1"',
    'content-unique-idem',
  )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
})

it('locks content edits while moderation review is pending', async () => {
  const row = {
    id: 'content_review_lock_123',
    content_type: 'article',
    owner_user_id: 'user_review_lock',
    creator_id: 'user_review_lock',
    ip_id: null,
    state: 'PENDING_REVIEW',
    version: 2,
    revision: 2,
    slug: 'review-lock',
    title: 'Under review article',
    body_ref: 'https://cdn.example.com/body.txt',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"2"',
    created_at: '2026-10-07T12:00:00.000Z',
    updated_at: '2026-10-07T12:01:00.000Z',
    idem_id: null,
    idem_owner_user_id: null,
    idem_request_hash: null,
    idem_status: null,
    idem_response_status: null,
    idem_response_json: null,
    idem_expires_at: null,
  }
  let batchCalled = false
  const db = {
    prepare() {
      return { bind: () => ({ first: async () => row }) }
    },
    batch: async () => { batchCalled = true },
  } as never
  await expect(updateContent(
    db,
    'user_review_lock',
    'content_review_lock_123',
    { contentType: 'article', title: 'Attempted edit during review', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"2"',
    'review-lock-idem',
  )).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  expect(batchCalled).toBe(false)
})

it('returns 409 for an owned but invalid lifecycle transition', async () => {
  const content = {
    id: 'content_123',
    content_type: 'article',
    owner_user_id: 'user_123',
    creator_id: 'user_123',
    ip_id: null,
    state: 'DRAFT',
    version: 1,
    revision: 1,
    slug: 'draft-content-abcdef',
    title: 'Draft content',
    body_ref: 'https://cdn.example.com/body.json',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"1"',
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  }
  const db = {
    prepare() { return { bind: () => ({ first: async () => content }) } },
    batch: async () => { throw new Error('batch should not run for an invalid transition') },
  } as never
  await expect(transitionContentState(
    db,
    'user_123',
    'L3',
    'content_123',
    'PUBLISHED',
    undefined,
    'W/"1"',
    'transition-invalid-state',
  )).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
})

it('blocks moderator layers from the generic state-transition path', async () => {
  const db = {
    prepare() { throw new Error('generic moderator transition must not reach D1') },
  } as never
  for (const layer of ['L6', 'L7', 'L8']) {
    await expect(transitionContentState(
      db,
      'moderator_123',
      layer,
      'content_123',
      'APPROVED',
      undefined,
      'W/"2"',
      'moderation-bypass-test-' + layer,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
  }
})

it('keeps create idempotency replay byte-stable across retry time', async () => {
  const original = {
    id: 'content_create_123',
    contentType: 'article',
    ownerUserId: 'user_123',
    creatorId: 'user_123',
    ipId: null,
    state: 'DRAFT',
    version: 1,
    revision: 1,
    slug: 'draft-content-abcdef',
    title: 'Draft content',
    bodyRef: 'https://cdn.example.com/body.json',
    mediaRefs: [],
    coverRef: null,
    etag: 'W/"1"',
    createdAt: '2026-10-07T07:00:00.000Z',
    updatedAt: '2026-10-07T07:00:00.000Z',
  }
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      )
    }
    return value
  }
  const hashInput = canonicalize({
    operationId: 'createContent',
    input: {
      ownerUserId: 'user_123',
      input: {
        contentType: 'article',
        title: 'Draft content',
        bodyRef: 'https://cdn.example.com/body.json',
        mediaRefs: [],
        coverRef: null,
      },
    },
  })
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(hashInput)),
  )
  const hashHex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const db = {
    prepare() {
      return {
        bind: () => ({
          first: async () => ({
            idem_id: 'idem_123',
            idem_owner_user_id: 'user_123',
            idem_request_hash: hashHex,
            idem_status: 'COMPLETED',
            idem_response_status: 201,
            idem_response_json: JSON.stringify(original),
            idem_expires_at: '2026-10-08T07:00:00.000Z',
          }),
        }),
      }
    },
    batch: async () => { throw new Error('batch should not run on an idempotency replay') },
  } as never
  const result = await createContent(
    db,
    'user_123',
    { contentType: 'article', title: 'Draft content', bodyRef: 'https://cdn.example.com/body.json', mediaRefs: [], coverRef: null },
    'create-key',
    new Date('2026-10-07T08:00:00.000Z'),
  )
  expect(result).toEqual(original)
})

describe('1.1 content lifecycle idempotency', () => {
  it('replays a duplicate publish transition without advancing the content version', async () => {
    const contentId = 'content_publish_retry_123'
    const idempotencyKey = 'publish-retry-key'
    const ifMatch = 'W/"4"'
    const result = {
      from: 'APPROVED',
      to: 'PUBLISHED',
      version: 5,
      etag: 'W/"5"',
    }

    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => [key, canonicalize(nested)]),
        )
      }
      return value
    }

    const hashInput = canonicalize({
      operationId: 'transitionContentState',
      input: {
        contentId,
        to: 'PUBLISHED',
        reason: null,
        ifMatch: '4',
      },
    })
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(hashInput)),
    )
    const requestHash = Array.from(
      new Uint8Array(digest),
      byte => byte.toString(16).padStart(2, '0'),
    ).join('')

    let batchCalled = false
    const db = {
      prepare() {
        return {
          bind: () => ({
            first: async () => ({
              id: contentId,
              content_type: 'article',
              owner_user_id: 'user_publish_retry',
              creator_id: 'user_publish_retry',
              ip_id: null,
              state: 'APPROVED',
              version: 4,
              revision: 4,
              slug: 'publish-retry',
              title: 'Retry-safe publish',
              body_ref: 'https://cdn.example.com/body.json',
              media_refs_json: '[]',
              cover_ref: null,
              etag: ifMatch,
              created_at: '2026-10-08T00:00:00.000Z',
              updated_at: '2026-10-08T00:01:00.000Z',
              idem_id: 'idem_publish_retry',
              idem_owner_user_id: 'user_publish_retry',
              idem_request_hash: requestHash,
              idem_status: 'COMPLETED',
              idem_response_status: 200,
              idem_response_json: JSON.stringify(result),
              idem_expires_at: '2026-10-09T00:00:00.000Z',
            }),
          }),
        }
      },
      batch: async () => {
        batchCalled = true
        throw new Error('duplicate publish must not write a second transition')
      },
    } as never

    await expect(
      transitionContentState(
        db,
        'user_publish_retry',
        'L3',
        contentId,
        'PUBLISHED',
        undefined,
        ifMatch,
        idempotencyKey,
        new Date('2026-10-08T00:02:00.000Z'),
      ),
    ).resolves.toEqual(result)

    expect(batchCalled).toBe(false)
  })
})
