import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { canTransitionContentState, ContentRuntimeError, type ContentMutationStore, type ContentRecord, createContent, createRequestId, deleteContent, getContent, decodeContentListCursor, decodeCursor, decodeScopedCursor, encodeContentListCursor, encodeCursor, encodeScopedCursor, isState, listContents, listPublishedContentsByIds, listContentRevisions, listCreatorContents, listDueScheduledContentCandidates, publishAuthorizedScheduledContents, publicContent, toErrorResponse, transitionContentState, updateContent, validateInput, validateListFilters } from './content-runtime.js'
import w03Worker, { createW03ContentWorker, hasCreatorContentPermission, hasSocialPostPermission, parseListLimit } from './index.js'

const makeContentMutationStore = (
  row: Record<string, unknown>,
  update: () => Promise<void> = async () => undefined,
  transition: (input: Parameters<ContentMutationStore['transition']>[0]) => Promise<void> = async () => undefined,
) => ({
  async loadMutation() {
    return {
      content: {
        id: row.id as string,
        contentType: row.content_type as ContentRecord['contentType'],
        ownerUserId: row.owner_user_id as string,
        creatorId: (row.creator_id as string | null | undefined) ?? null,
        ipId: (row.ip_id as string | null | undefined) ?? null,
        state: row.state as ContentRecord['state'],
        scheduledAt: (row.scheduled_at as string | null | undefined) ?? null,
        accessMode: row.access_mode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC',
        version: row.version as number,
        revision: row.revision as number,
        slug: row.slug as string,
        title: row.title as string,
        bodyRef: row.body_ref as string,
        mediaRefs: JSON.parse((row.media_refs_json as string | undefined) ?? '[]') as string[],
        coverRef: (row.cover_ref as string | null | undefined) ?? null,
        mediaWarning: (row.media_warning as ContentRecord['mediaWarning'] | undefined) ?? null,
        etag: row.etag as string,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      } satisfies ContentRecord,
      idempotency: {
        idem_id: (row.idem_id as string | null | undefined) ?? null,
        idem_owner_user_id: (row.idem_owner_user_id as string | null | undefined) ?? null,
        idem_request_hash: (row.idem_request_hash as string | null | undefined) ?? null,
        idem_status: (row.idem_status as 'IN_PROGRESS' | 'COMPLETED' | null | undefined) ?? null,
        idem_response_status: (row.idem_response_status as number | null | undefined) ?? null,
        idem_response_json: (row.idem_response_json as string | null | undefined) ?? null,
        idem_expires_at: (row.idem_expires_at as string | null | undefined) ?? null,
      },
    }
  },
  update,
  transition,
  async delete() {},
  async moderationTransition() {},
  async loadRevision() { return null },
  async rollback() {},
  async listDueScheduled() { return [] },
  async publishScheduled() { return 0 },
})

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
    let matchingRows: Array<Record<string, unknown>> = []
    const lookups: Array<{ candidates: readonly string[]; limit: number }> = []
    const neonWorker = createW03ContentWorker({
      publishedMediaReferenceReadStore: {
        async listPublishedMediaReferences(candidates, limit) {
          lookups.push({ candidates, limit })
          return matchingRows as never
        },
      },
    })
    let w07Calls = 0
    const w07Capture: { request?: Request } = {}
    const env = {
      W07_SUBSCRIPTION: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          w07Calls += 1
          w07Capture.request = input instanceof Request ? input : new Request(input, init)
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
    const publicResponse = await neonWorker.fetch(request(publicUrl), env)
    expect(publicResponse.status).toBe(200)
    await expect(publicResponse.json()).resolves.toMatchObject({
      data: { isPublic: true, isMemberContent: false, allowed: true },
    })
    expect(lookups.at(-1)?.limit).toBe(51)
    expect(lookups.at(-1)?.candidates).toContain(publicUrl)
    expect(lookups.at(-1)?.candidates).not.toContain(historicalUrl)
    expect(w07Calls).toBe(0)

    matchingRows = [memberPost]
    const memberRequest = request(publicUrl, 'W01', {
      'X-LuckRead-Principal-User-Id': 'user_subscriber',
      'X-LuckRead-Principal-Layer': 'L2',
    })
    const memberResponse = await neonWorker.fetch(memberRequest, env)
    expect(memberResponse.status).toBe(200)
    await expect(memberResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: true, allowed: true },
    })
    expect(w07Calls).toBe(1)
    expect(w07Capture.request?.url).toContain('/internal/entitlements/check-creator-membership')
    expect(w07Capture.request?.headers.get('X-LuckRead-Caller')).toBe('W03')
    expect(w07Capture.request?.headers.get('X-LuckRead-Principal-User-Id')).toBe('user_subscriber')
    expect(w07Capture.request?.headers.get('Cookie')).toBeNull()
    expect(await w07Capture.request?.json()).toEqual({ creatorId: 'creator_1' })

    // Without a logged-in member, a member-only reference must not be exposed as public.
    w07Calls = 0
    const anonymousMemberResponse = await neonWorker.fetch(request(publicUrl), env)
    expect(anonymousMemberResponse.status).toBe(200)
    await expect(anonymousMemberResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: true, allowed: false },
    })
    expect(w07Calls).toBe(0)

    // If a URL appears in both public and member-only content, membership wins:
    // it cannot become anonymous-public through the second reference.
    matchingRows = [publicPost, memberPost]
    const mixedReferenceResponse = await neonWorker.fetch(request(publicUrl), env)
    await expect(mixedReferenceResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: true, allowed: false },
    })

    matchingRows = []
    const unpublishedResponse = await neonWorker.fetch(
      request('https://img.luckread.com/media/draft-only.png'),
      env,
    )
    expect(unpublishedResponse.status).toBe(200)
    await expect(unpublishedResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: false, allowed: false },
    })

    const unsupportedHostResponse = await neonWorker.fetch(
      request('https://attacker.example/media/photo.png'),
      env,
    )
    expect(unsupportedHostResponse.status).toBe(200)
    await expect(unsupportedHostResponse.json()).resolves.toMatchObject({
      data: { isPublic: false, isMemberContent: false, allowed: false },
    })

    const untrustedCaller = await neonWorker.fetch(request(publicUrl, 'W04'), env)
    expect(untrustedCaller.status).toBe(403)

    const forwardedCredential = await neonWorker.fetch(
      request(publicUrl, 'W01', { Cookie: 'session=must-not-cross-service-boundary' }),
      env,
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
    const neonWorker = createW03ContentWorker({
      contentDetailReadStoreProvider: () => ({
        getContent: async () => ({ ...contentRow }),
      } as never),
    })
    let providerStatus = 200;
    let allowed = false;
    let reasonOverride: string | null = null;
    let providerCalls = 0;
    const allowLimiter = { limit: async () => ({ success: true }) };
    const env = {
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

    const denied = await neonWorker.fetch(makeRequest(), env);
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
    const entitled = await neonWorker.fetch(makeRequest(), env);
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
    const contradictory = await neonWorker.fetch(makeRequest(), env);
    expect(contradictory.status).toBe(503);
    await expect(contradictory.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(providerCalls).toBe(3);

    reasonOverride = null;
    providerStatus = 503;
    const unavailable = await neonWorker.fetch(makeRequest(), env);
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
    const contextLookups: Array<{ bodyRef: string; limit: number }> = []
    const neonWorker = createW03ContentWorker({
      contentDetailReadStoreProvider: () => ({
        getContent: async () => ({ ...publicContentRow }),
      } as never),
      contentContextReadStoreProvider: () => ({
        listPublishedMembersOnlyBodyReferences: async (value: string, limit: number) => {
          contextLookups.push({ bodyRef: value, limit })
          return memberReferenceRows
        },
      } as never),
    })
    let allowed = false
    let entitlementChecks = 0
    const allowLimiter = { limit: async () => ({ success: true }) }
    const env = {
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

    const denied = await neonWorker.fetch(makeRequest(), env)
    expect(denied.status).toBe(200)
    await expect(denied.json()).resolves.toMatchObject({
      contentId: 'content_public_1',
      accessMode: 'PUBLIC',
      accessGranted: false,
      bodyRef: '',
    })
    expect(entitlementChecks).toBe(1)
    expect(contextLookups).toEqual([{ bodyRef, limit: 51 }])

    allowed = true
    const entitled = await neonWorker.fetch(makeRequest(), env)
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
      id: 'content_1', content_type: 'post' as const, owner_user_id: 'user_1', creator_id: 'user_1',
      ip_id: null, state: 'PUBLISHED', scheduled_at: null, version: 1, revision: 1,
      slug: 'post-1', title: 'Post 1', body_ref: 'body_1', media_refs_json: '[]',
      cover_ref: null, etag: 'W/"1"', created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    }
    let storeCalls = 0
    const neonWorker = createW03ContentWorker({
      publishedContentsByIdsReadStoreProvider: (_env: never) => ({
        list: async (ids: readonly string[]) => {
          storeCalls += 1
          expect(ids).toEqual(['content_1'])
          return [row]
        },
      } as never),
    })
    const env = {} as never
    const response = await neonWorker.fetch(
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
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'content_1', title: 'Post 1' }] },
    })
    expect(storeCalls).toBe(1)
    const denied = await neonWorker.fetch(
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
    )
    expect(denied.status).toBe(403)
    expect(storeCalls).toBe(1)
  })


  // Social-context route coverage uses the Neon context store in content-context-read-routes.test.ts.


  it('loads a bounded list of published content IDs in bookmark order through Neon', async () => {
    const rows = [
      {
        id: 'content_2', content_type: 'post', owner_user_id: 'user_2', creator_id: 'user_2',
        ip_id: null, state: 'PUBLISHED', scheduled_at: null, access_mode: 'PUBLIC',
        version: 1, revision: 1, slug: 'post-2', title: 'Post 2', body_ref: 'body_2',
        media_refs_json: '[]', cover_ref: null, media_warning: null, etag: 'W/"1"',
        created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z',
      },
      {
        id: 'content_1', content_type: 'article', owner_user_id: 'user_1', creator_id: 'user_1',
        ip_id: null, state: 'PUBLISHED', scheduled_at: null, access_mode: 'PUBLIC',
        version: 1, revision: 1, slug: 'article-1', title: 'Article 1', body_ref: 'body_1',
        media_refs_json: '[]', cover_ref: null, media_warning: null, etag: 'W/"1"',
        created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      },
    ]
    const list = vi.fn(async (ids: readonly string[]) => rows as never)
    const store = { list }
    const items = await listPublishedContentsByIds(store, ['content_2', 'content_1'])
    expect(items.map(item => item.id)).toEqual(['content_2', 'content_1'])
    expect(list).toHaveBeenCalledWith(['content_2', 'content_1'])
    await expect(listPublishedContentsByIds(store, Array.from({ length: 51 }, (_, i) => 'content_' + i)))
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

  it('binds creator content pagination to owner and active filters through Neon', async () => {
    const row = {
      id: 'content_video_123', content_type: 'video', owner_user_id: 'user_123',
      creator_id: 'user_123', ip_id: null, state: 'DRAFT', scheduled_at: null,
      access_mode: 'PUBLIC', version: 1, revision: 1, slug: 'video-123',
      title: 'Draft video', body_ref: 'https://cdn.example.com/body.txt', media_refs_json: '[]',
      cover_ref: null, media_warning: null, etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z', updated_at: '2026-10-02T12:01:00.000Z',
    }
    const calls: unknown[][] = []
    const store = {
      async list(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number, filters: { status?: string; contentType?: string }) {
        calls.push([ownerUserId, cursor, limit, filters])
        return [row, { ...row, id: 'content_video_124' }] as never
      },
    }
    const first = await listCreatorContents(store, 'user_123', null, 1, {
      status: 'DRAFT',
      contentType: 'video',
    })
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toEqual(expect.any(String))
    await expect(listCreatorContents(store, 'user_123', first.nextCursor, 1, {
      status: 'DRAFT',
      contentType: 'article',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listCreatorContents(store, 'user_999', first.nextCursor, 1, {
      status: 'DRAFT',
      contentType: 'video',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(calls).toEqual([['user_123', null, 2, { status: 'DRAFT', contentType: 'video' }]])
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
      contentId: 'content_123',
      revision: 2,
      contentVersion: 2,
      actorUserId: 'user_123',
      sourceRevision: 1,
      operation: 'UPDATE',
      state: 'DRAFT',
      accessMode: 'PUBLIC',
      slug: 'article-123',
      title: 'Revision title',
      bodyRef: 'https://cdn.example.com/body.txt',
      mediaRefs: [],
      coverRef: null,
      mediaWarning: null,
      etag: 'W/"2"',
      reason: null,
      correlationId: 'test-correlation',
      createdAt: '2026-10-02T12:01:00.000Z',
    }
    let listCalls = 0
    const readStore = {
      async list() {
        listCalls += 1
        return [row, { ...row, id: 'revision_1' }]
      },
      async get() { return row },
    } as never
    const first = await listContentRevisions(readStore, 'user_123', 'content_123', null, 1)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toEqual(expect.any(String))
    await expect(listContentRevisions(readStore, 'user_123', 'content_999', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    await expect(listContentRevisions(readStore, 'user_999', 'content_123', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(listCalls).toBe(1)
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
    let loadCount = 0
    const mutationStore = {
      ...makeContentMutationStore(row),
      async loadMutation() {
        loadCount += 1
        return makeContentMutationStore(row).loadMutation()
      },
    } as never

    await expect(
      updateContent(
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
        mutationStore,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(loadCount).toBe(1)
  })

  it('allows only the contracted creator and moderator transitions', () => {
    expect(canTransitionContentState('DRAFT', 'PENDING_REVIEW', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true, undefined, 'article')).toBe(false)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true, undefined, 'post')).toBe(true)
    expect(canTransitionContentState('DRAFT', 'SCHEDULED', 'CREATOR', true, undefined, 'post')).toBe(true)
    expect(canTransitionContentState('DRAFT', 'SCHEDULED', 'CREATOR', true, undefined, 'article')).toBe(false)
    expect(canTransitionContentState('DRAFT', 'SCHEDULED', 'SOCIAL_AUTHOR', true, undefined, 'post')).toBe(false)
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
    const mutationStore = {
      async loadMutation() {
        return {
          content: {
            id: row.id,
            contentType: row.content_type,
            ownerUserId: row.owner_user_id,
            state: row.state,
            version: row.version,
            etag: row.etag,
          } as ContentRecord,
          idempotency: {
            idem_id: null,
            idem_owner_user_id: null,
            idem_request_hash: null,
            idem_status: null,
            idem_response_status: null,
            idem_response_json: null,
            idem_expires_at: null,
          },
        }
      },
      async update() { throw new Error('a denied mutation must not write') },
      async delete() { throw new Error('a denied mutation must not write') },
    } as never

    for (const layer of ['L2', 'L5', 'L6', 'L7', 'L8']) {
      await expect(
        updateContent(
          'user_article_guard_1',
          'content_article_guard_1',
          { contentType: 'post', title: 'Spoofed type', bodyRef: 'https://cdn.example.com/body.txt', mediaRefs: [], coverRef: null },
          'W/"1"',
          'spoof-type-key-' + layer,
          mutationStore,
          new Date('2026-10-16T00:01:00.000Z'),
          'test',
          layer,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })

      await expect(
        deleteContent(
          'user_article_guard_1',
          'content_article_guard_1',
          'W/"1"',
          'delete-article-key-' + layer,
          new Date('2026-10-16T00:01:00.000Z'),
          layer,
          mutationStore,
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
    const db = makeContentMutationStore(row)

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
      let transitionCalled = false
      const db = makeContentMutationStore(row, async () => undefined, async () => {
        transitionCalled = true
      })

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
      expect(transitionCalled).toBe(true)
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
    let transitionCalls = 0
    const db = makeContentMutationStore(row, async () => undefined, async () => {
      transitionCalls += 1
    })
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
    expect(transitionCalls).toBe(0)

    const published = await transition('creator_verified_1')
    expect(published).toMatchObject({ from: 'DRAFT', to: 'PUBLISHED', version: 2 })
    expect(transitionCalls).toBe(1)
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
    const db = makeContentMutationStore(row)

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

  it('schedules a draft social post only after W03 publish preflight succeeds', async () => {
    const row = {
      id: 'content_scheduled_post_1',
      content_type: 'post',
      owner_user_id: 'user_creator_schedule',
      creator_id: 'user_creator_schedule',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      access_mode: 'PUBLIC',
      version: 1,
      revision: 1,
      slug: 'scheduled-post-1',
      title: 'A useful update',
      body_ref: 'https://img.luckread.com/media/scheduled-body.txt',
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
    let transitionInput: Parameters<ContentMutationStore['transition']>[0] | undefined
    const db = makeContentMutationStore(row, async () => undefined, async (input) => {
      transitionInput = input
    })
    const scheduledAt = '2026-10-16T00:30:00.000Z'
    const preflight = {
      contentType: 'post',
      title: 'A useful update',
      body: 'I am sharing a useful update from our recent work and a few lessons learned along the way.',
      mediaRefs: [],
      coverRef: null,
      aiMode: 'none',
      humanContribution: 'substantial',
    }

    const result = await transitionContentState(
      db,
      'user_creator_schedule',
      'L3',
      row.id,
      'SCHEDULED',
      undefined,
      row.etag,
      'schedule-draft-social-post',
      new Date('2026-10-16T00:01:00.000Z'),
      { scheduledAt, preflight, verifiedCreatorId: 'creator-canonical-1' },
    )

    expect(result).toMatchObject({
      from: 'DRAFT',
      to: 'SCHEDULED',
      version: 2,
      etag: 'W/"2"',
      scheduledAt,
    })
    expect(transitionInput).toMatchObject({
      nextState: 'SCHEDULED',
      scheduledAt,
      nextCreatorId: 'creator-canonical-1',
      expectedVersion: 1,
      expectedEtag: 'W/"1"',
    })
  })

  it('does not schedule a draft social post when its W03 publish preflight is missing', async () => {
    const row = {
      id: 'content_scheduled_post_missing_preflight',
      content_type: 'post',
      owner_user_id: 'user_creator_schedule',
      creator_id: 'user_creator_schedule',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      access_mode: 'PUBLIC',
      version: 1,
      revision: 1,
      slug: 'scheduled-post-missing-preflight',
      title: 'A useful update',
      body_ref: 'https://img.luckread.com/media/scheduled-body.txt',
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
    let transitionCalled = false
    const db = makeContentMutationStore(row, async () => undefined, async () => {
      transitionCalled = true
    })

    await expect(transitionContentState(
      db,
      'user_creator_schedule',
      'L3',
      row.id,
      'SCHEDULED',
      undefined,
      row.etag,
      'schedule-without-preflight',
      new Date('2026-10-16T00:01:00.000Z'),
      {
        scheduledAt: '2026-10-16T00:30:00.000Z',
        verifiedCreatorId: 'creator-canonical-1',
      },
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(transitionCalled).toBe(false)
  })

  it('rejects scheduled publication when W08 has not verified a canonical Creator identity', async () => {
    const row = {
      id: 'content_scheduled_post_without_creator_identity',
      content_type: 'post',
      owner_user_id: 'user_creator_schedule',
      creator_id: 'user_creator_schedule',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      access_mode: 'PUBLIC',
      version: 1,
      revision: 1,
      slug: 'scheduled-post-without-creator',
      title: 'A useful update',
      body_ref: 'https://img.luckread.com/media/scheduled-body.txt',
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
    let transitionCalled = false
    const db = makeContentMutationStore(row, async () => undefined, async () => {
      transitionCalled = true
    })
    const preflight = {
      contentType: 'post',
      title: 'A useful update',
      body: 'A useful update with enough detail to pass the basic post preflight validation.',
      mediaRefs: [],
      coverRef: null,
      aiMode: 'none',
      humanContribution: 'substantial',
    }

    await expect(transitionContentState(
      db,
      'user_creator_schedule',
      'L3',
      row.id,
      'SCHEDULED',
      undefined,
      row.etag,
      'schedule-without-creator-verification',
      new Date('2026-10-16T00:01:00.000Z'),
      {
        scheduledAt: '2026-10-16T00:30:00.000Z',
        preflight,
      },
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(transitionCalled).toBe(false)
  })

  it('requires a future timestamp before scheduling an approved content item', async () => {
    const db = undefined as never

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

  it('lists only due scheduled candidates with canonical owner and Creator IDs', async () => {
    let requestedAt = ''
    let requestedLimit = 0
    const dueCandidates = [{
      contentId: 'scheduled_due_1',
      ownerUserId: 'owner_1',
      creatorId: 'creator_1',
      version: 4,
      scheduledAt: '2026-10-08T12:00:00.000Z',
    }]
    const store = {
      async listDueScheduled(nowIso: string, limit: number) {
        requestedAt = nowIso
        requestedLimit = limit
        return dueCandidates
      },
    } as never

    await expect(
      listDueScheduledContentCandidates(store, new Date('2026-10-08T12:02:00.000Z'), 50),
    ).resolves.toEqual(dueCandidates)
    expect(requestedAt).toBe('2026-10-08T12:02:00.000Z')
    expect(requestedLimit).toBe(50)
  })

  it('commits only W08-authorized candidates with a final owner/creator/version/time CAS', async () => {
    const now = new Date('2026-10-08T12:02:00.000Z')
    const authorized = {
      decision: 'ALLOW',
      policyVersion: 'casl-l0-l8-v1',
      layer: 'L3',
      action: 'content.publish.own',
      resourceType: 'Content',
      ownerUserId: 'owner_1',
      creatorId: 'creator_1',
    }
    let submittedCandidates: readonly unknown[] = []
    let submittedAt = ''
    const store = {
      async publishScheduled(candidates: readonly unknown[], nowIso: string) {
        submittedCandidates = candidates
        submittedAt = nowIso
        return 1
      },
    } as never

    await expect(publishAuthorizedScheduledContents(store, [
      {
        contentId: 'scheduled_due_1',
        ownerUserId: 'owner_1',
        expectedCreatorId: 'owner_1',
        creatorId: 'creator_1',
        version: 4,
        scheduledAt: '2026-10-08T12:00:00.000Z',
        authorization: authorized,
      },
      {
        contentId: 'scheduled_due_2',
        ownerUserId: 'owner_2',
        expectedCreatorId: 'creator_2',
        creatorId: 'creator_2',
        version: 7,
        scheduledAt: '2026-10-08T12:01:00.000Z',
        authorization: { ...authorized, ownerUserId: 'someone-else' },
      },
      {
        contentId: 'scheduled_due_3',
        ownerUserId: 'owner_3',
        expectedCreatorId: 'creator_3',
        creatorId: 'creator_3',
        version: 2,
        scheduledAt: '2026-10-08T12:03:00.000Z',
        authorization: { ...authorized, ownerUserId: 'owner_3', creatorId: 'creator_3' },
      },
    ], now)).resolves.toEqual({
      scanned: 3,
      authorized: 1,
      published: 1,
      rejected: 2,
    })

    expect(submittedCandidates).toEqual([{
      contentId: 'scheduled_due_1',
      ownerUserId: 'owner_1',
      expectedCreatorId: 'owner_1',
      creatorId: 'creator_1',
      version: 4,
      scheduledAt: '2026-10-08T12:00:00.000Z',
      authorization: authorized,
    }])
    expect(submittedAt).toBe('2026-10-08T12:02:00.000Z')
  })

  it('does not publish when the final compare-and-set loses a concurrent race', async () => {
    let publishedCandidates = 0
    const store = {
      async publishScheduled(candidates: readonly unknown[]) {
        publishedCandidates = candidates.length
        return 0
      },
    } as never
    await expect(publishAuthorizedScheduledContents(store, [{
      contentId: 'scheduled_race_1',
      ownerUserId: 'owner_1',
      expectedCreatorId: 'creator_1',
      creatorId: 'creator_1',
      version: 4,
      scheduledAt: '2026-10-08T12:00:00.000Z',
      authorization: {
        decision: 'ALLOW',
        policyVersion: 'casl-l0-l8-v1',
        layer: 'L3',
        action: 'content.publish.own',
        resourceType: 'Content',
        ownerUserId: 'owner_1',
        creatorId: 'creator_1',
      },
    }], new Date('2026-10-08T12:02:00.000Z'))).resolves.toMatchObject({
      scanned: 1,
      authorized: 1,
      published: 0,
      rejected: 0,
    })
    expect(publishedCandidates).toBe(1)
  })

  it('serves scheduled due candidates only to the credential-free W01 background transport', async () => {
    let storeReads = 0
    const neonWorker = createW03ContentWorker({
      contentMutationStoreProvider: () => ({
        listDueScheduled: async () => {
          storeReads += 1
          return [{ contentId: 'scheduled_route_1', ownerUserId: 'owner_1', creatorId: 'creator_1', version: 3, scheduledAt: '2026-10-08T12:00:00.000Z' }]
        },
      } as never),
    })
    const limiter = { limit: async () => ({ success: true }) }
    const env = {
      CONTENT_ORIGIN_GLOBAL_LIMITER: limiter,
      CONTENT_PUBLIC_READ_LIMITER: limiter,
      CONTENT_MUTATION_LIMITER: limiter,
    } as never
    const headers = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'scheduled-due-route-test',
      'X-LuckRead-Rate-Key': 'scheduled-publish',
    }

    const response = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/scheduled-due?limit=50', { headers }),
      env,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{
          contentId: 'scheduled_route_1',
          ownerUserId: 'owner_1',
          creatorId: 'creator_1',
          version: 3,
        }],
      },
    })
    expect(storeReads).toBe(1)

    const unavailable = await createW03ContentWorker().fetch(
      new Request('https://luckread-w03.internal/internal/content/scheduled-due?limit=50', { headers }),
      env,
    )
    expect(unavailable.status).toBe(503)

    const denied = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/scheduled-due?limit=50', {
        headers: { ...headers, Cookie: 'must-not-cross-internal-transport' },
      }),
      env,
    )
    expect(denied.status).toBe(403)
    expect(storeReads).toBe(1)
  })

  it('routes W08 authorization evidence to the final W03 compare-and-set', async () => {
    const published: unknown[] = []
    const neonWorker = createW03ContentWorker({
      contentMutationStoreProvider: () => ({
        publishScheduled: async (candidates: readonly unknown[]) => {
          published.push(...candidates)
          return candidates.length
        },
      } as never),
    })
    const limiter = { limit: async () => ({ success: true }) }
    const env = {
      CONTENT_ORIGIN_GLOBAL_LIMITER: limiter,
      CONTENT_PUBLIC_READ_LIMITER: limiter,
      CONTENT_MUTATION_LIMITER: limiter,
    } as never
    const response = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/scheduled-publish/commit', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'scheduled-commit-route-test',
          'X-LuckRead-Rate-Key': 'scheduled-publish',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          items: [{
            contentId: 'scheduled_route_2',
            ownerUserId: 'owner_2',
            expectedCreatorId: 'creator_2',
            creatorId: 'creator_2',
            version: 2,
            scheduledAt: '2026-10-08T12:00:00.000Z',
            authorization: {
              decision: 'ALLOW',
              policyVersion: 'casl-l0-l8-v1',
              layer: 'L4',
              action: 'content.publish.own',
              resourceType: 'Content',
              ownerUserId: 'owner_2',
              creatorId: 'creator_2',
            },
          }],
        }),
      }),
      env,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { scanned: 1, authorized: 1, published: 1, rejected: 0 },
    })
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ contentId: 'scheduled_route_2', ownerUserId: 'owner_2', creatorId: 'creator_2', version: 2 })

    const unavailable = await createW03ContentWorker().fetch(
      new Request('https://luckread-w03.internal/internal/content/scheduled-publish/commit', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'scheduled-commit-unavailable-test',
          'X-LuckRead-Rate-Key': 'scheduled-publish',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ items: [] }),
      }),
      env,
    )
    expect(unavailable.status).toBe(503)
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
    for (const limit of ['0', '51', '1.5', 'abc']) {
      const response = await w03Worker.fetch(
        new Request('https://luckread-w03.internal/internal/content/contents?limit=' + limit, {
          headers: {
            'X-LuckRead-Caller': 'W01',
            'X-LuckRead-Transport-Version': '1.0',
            'X-LuckRead-Correlation-Id': 'test-correlation-' + limit,
          },
        }),
        {} as never,
      )

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
        requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]+$/),
      })
    }
  })



  it('lists native social drafts only for the authenticated owner at L2+', async () => {
    const row = {
      id: 'native_draft_123',
      content_type: 'post',
      owner_user_id: 'user_draft_owner',
      creator_id: 'user_draft_owner',
      ip_id: null,
      state: 'DRAFT',
      scheduled_at: null,
      access_mode: 'MEMBERS_ONLY',
      version: 4,
      revision: 4,
      slug: 'native-draft-123',
      title: 'Private draft body',
      body_ref: 'https://img.luckread.com/drafts/body.txt',
      media_refs_json: '["https://img.luckread.com/drafts/photo.jpg"]',
      cover_ref: 'https://img.luckread.com/drafts/photo.jpg',
      etag: 'W/"4"',
      created_at: '2026-11-04T12:00:00.000Z',
      updated_at: '2026-11-04T12:04:00.000Z',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    };
    const storeCalls: unknown[][] = []
    const neonWorker = createW03ContentWorker({
      creatorContentsReadStoreProvider: () => ({
        list: async (...args: unknown[]) => { storeCalls.push(args); return [row] },
      } as never),
    })

    const response = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents?status=DRAFT&type=post&limit=20', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'native-draft-list',
          'X-LuckRead-Principal-User-Id': 'user_draft_owner',
          'X-LuckRead-Principal-Layer': 'L2',
        },
      }),
      {} as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{
          id: 'native_draft_123',
          contentType: 'post',
          state: 'DRAFT',
          accessMode: 'MEMBERS_ONLY',
          bodyRef: 'https://img.luckread.com/drafts/body.txt',
          mediaRefs: ['https://img.luckread.com/drafts/photo.jpg'],
          etag: 'W/"4"',
        }],
        hasMore: false,
        nextCursor: null,
      },
    });
    expect(storeCalls).toHaveLength(1)
    expect(storeCalls[0]?.slice(0, 4)).toEqual(['user_draft_owner', null, 21, { status: 'DRAFT', contentType: 'post' }])

    const denied = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents?status=DRAFT&type=post', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'native-draft-list-denied',
          'X-LuckRead-Principal-User-Id': 'user_draft_owner',
          'X-LuckRead-Principal-Layer': 'L1',
        },
      }),
      {} as never,
    );
    expect(denied.status).toBe(403);
    expect(storeCalls).toHaveLength(1);
  });

  it('lists only the authenticated Creator\'s scheduled social posts and returns edit preconditions', async () => {
    const storeCalls: unknown[][] = []
    const row = {
      id: 'scheduled_post_123',
      content_type: 'post',
      owner_user_id: 'creator_owner_123',
      creator_id: 'creator_123',
      ip_id: null,
      state: 'SCHEDULED',
      scheduled_at: '2026-11-08T18:30:00.000Z',
      access_mode: 'PUBLIC',
      version: 4,
      revision: 2,
      slug: 'scheduled-post-123',
      title: 'Scheduled post',
      body_ref: 'https://img.luckread.com/body.txt',
      media_refs_json: JSON.stringify(['https://img.luckread.com/photo.jpg']),
      cover_ref: 'https://img.luckread.com/photo.jpg',
      etag: 'W/"4"',
      created_at: '2026-11-05T10:00:00.000Z',
      updated_at: '2026-11-05T10:05:00.000Z',
    }
    const neonWorker = createW03ContentWorker({
      creatorContentsReadStoreProvider: () => ({
        list: async (...args: unknown[]) => { storeCalls.push(args); return [row] },
      } as never),
    })
    const makeRequest = (layer = 'L3', query = '?status=SCHEDULED&type=post&limit=20') =>
      new Request('https://luckread-w03.internal/internal/content/contents' + query, {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'native-scheduled-list',
          'X-LuckRead-Principal-User-Id': 'creator_owner_123',
          'X-LuckRead-Principal-Layer': layer,
        },
      })

    const response = await neonWorker.fetch(makeRequest(), {} as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{
          id: 'scheduled_post_123',
          contentType: 'post',
          state: 'SCHEDULED',
          version: 4,
          etag: 'W/"4"',
          scheduledAt: '2026-11-08T18:30:00.000Z',
          bodyRef: 'https://img.luckread.com/body.txt',
          mediaRefs: ['https://img.luckread.com/photo.jpg'],
          coverRef: 'https://img.luckread.com/photo.jpg',
        }],
        hasMore: false,
        nextCursor: null,
      },
    })
    expect(storeCalls).toHaveLength(1)
    expect(storeCalls[0]?.slice(0, 4)).toEqual(['creator_owner_123', null, 21, { status: 'SCHEDULED', contentType: 'post' }])

    const readsBeforeDeny = storeCalls.length
    const l2Denied = await neonWorker.fetch(makeRequest('L2'), {} as never)
    expect(l2Denied.status).toBe(403)
    const wrongType = await neonWorker.fetch(makeRequest('L3', '?status=SCHEDULED&type=article'), {} as never)
    expect(wrongType.status).toBe(422)
    expect(storeCalls).toHaveLength(readsBeforeDeny)
  })

  it('returns the canonical error envelope for an unmatched internal route', async () => {
    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/unmatched-route', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-unmatched-route',
        },
      }),
      {} as never,
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'NOT_FOUND', message: expect.any(String), details: {} },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]+$/),
    })
  })

  it('filters public content by content type using the Neon public list store', async () => {
    const row = {
      id: 'content_video_123', content_type: 'video', owner_user_id: 'user_123',
      creator_id: 'user_123', ip_id: null, state: 'PUBLISHED', scheduled_at: null,
      access_mode: 'PUBLIC', version: 1, revision: 1, slug: 'video-123',
      title: 'Published video', body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]', cover_ref: null, media_warning: null, etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z', updated_at: '2026-10-02T12:01:00.000Z',
    }
    const calls: unknown[] = []
    const store = {
      async list(input: unknown) {
        calls.push(input)
        return [row] as never
      },
      async search() { return [] as never },
    }
    const page = await listContents(store, null, 20, null, 'video')
    expect(page.items[0]?.contentType).toBe('video')
    expect(calls).toEqual([{
      cursor: null, limit: 21, creatorId: null, ownerUserId: null, contentType: 'video',
    }])
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
    const db = makeContentMutationStore(content)

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

  it('requires Neon persistence for content create, update, owner state, and moderation transitions', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )

    const createStart = runtime.indexOf('export async function createContent')
    expect(createStart).toBeGreaterThanOrEqual(0)
    const createEnd = runtime.indexOf('\nexport ', createStart + 10)
    const createSection = runtime.slice(createStart, createEnd >= 0 ? createEnd : runtime.length)
    expect(createSection).toContain('mutationStore.allocateContentId')
    expect(createSection).toContain('mutationStore.create(')
    expect(createSection).not.toContain('db.prepare')
    expect(createSection).not.toContain('batchMutation(db')
    expect(createSection).not.toContain('allocateContentSnowflakeId')

    const updateStart = runtime.indexOf('export async function updateContent')
    expect(updateStart).toBeGreaterThanOrEqual(0)
    const updateEnd = runtime.indexOf('\nexport async function rollbackContentRevision', updateStart)
    const updateSection = runtime.slice(updateStart, updateEnd)
    expect(updateSection).toContain('await mutationStore.loadMutation(')
    expect(updateSection).toContain('await mutationStore.update({')
    expect(updateSection).not.toContain('ContentD1')
    expect(updateSection).not.toContain('db.prepare')
    expect(updateSection).not.toContain('batchMutation')
    expect(updateSection).not.toContain('atomicGuard')

    const transitionStart = runtime.indexOf('export async function transitionContentState')
    expect(transitionStart).toBeGreaterThanOrEqual(0)
    const transitionEnd = runtime.indexOf('\nexport type DueScheduledContentCandidate', transitionStart)
    const transitionSection = runtime.slice(transitionStart, transitionEnd)
    expect(transitionSection).toContain('await mutationStore.loadMutation(')
    expect(transitionSection).toContain('await mutationStore.transition({')
    expect(transitionSection).not.toContain('ContentD1')
    expect(transitionSection).not.toContain('db.prepare')
    expect(transitionSection).not.toContain('batchMutation')
    expect(transitionSection).not.toContain('atomicGuard')

    const moderationStart = runtime.indexOf('export async function applyModerationContentTransition')
    expect(moderationStart).toBeGreaterThanOrEqual(0)
    const moderationSection = runtime.slice(moderationStart)
    expect(moderationSection).toContain("await mutationStore.loadMutation(")
    expect(moderationSection).toContain("await mutationStore.moderationTransition({")
    expect(moderationSection).not.toContain('ContentD1')
    expect(moderationSection).not.toContain('loadMutationRow(db')
    expect(moderationSection).not.toContain('db.prepare')
    expect(moderationSection).not.toContain('batchMutation')
    expect(moderationSection).not.toContain('atomicGuard')

    const dueReadStart = runtime.indexOf('export async function listDueScheduledContentCandidates')
    expect(dueReadStart).toBeGreaterThanOrEqual(0)
    const dueReadEnd = runtime.indexOf('\nexport async function publishAuthorizedScheduledContents', dueReadStart)
    const dueReadSection = runtime.slice(dueReadStart, dueReadEnd)
    expect(dueReadSection).toContain('return mutationStore.listDueScheduled(nowIso, limit)')
    expect(dueReadSection).not.toContain('ContentD1')
    expect(dueReadSection).not.toContain('db.prepare')

    const scheduledPublishStart = runtime.indexOf('export async function publishAuthorizedScheduledContents')
    expect(scheduledPublishStart).toBeGreaterThanOrEqual(0)
    const scheduledPublishEnd = runtime.indexOf('\nexport function encodeCursor', scheduledPublishStart)
    const scheduledPublishSection = runtime.slice(scheduledPublishStart, scheduledPublishEnd)
    expect(scheduledPublishSection).toContain('await mutationStore.publishScheduled(authorizedCandidates, nowIso)')
    expect(scheduledPublishSection).not.toContain('ContentD1')
    expect(scheduledPublishSection).not.toContain('db.prepare')
    expect(scheduledPublishSection).not.toContain('batch')

    const deleteStart = runtime.indexOf('export async function deleteContent')
    expect(deleteStart).toBeGreaterThanOrEqual(0)
    const deleteEnd = runtime.indexOf('\nconst isSocialOnlyLayer', deleteStart)
    const deleteSection = runtime.slice(deleteStart, deleteEnd)
    expect(deleteSection).toContain('await mutationStore.delete({')
    expect(deleteSection).not.toContain('db.prepare')
    expect(deleteSection).not.toContain('batchMutation')
    expect(deleteSection).not.toContain('ContentD1')

    expect(runtime).not.toMatch(/\bContentD1\b|\bD1PreparedStatement\b|\.prepare\s*\(|\.batch\s*\(/)
    const worker = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/index.ts'),
      'utf8',
    )
    expect(worker).not.toMatch(/\bD1_02\b|NO_LEGACY_DATABASE_HANDLE/)
    expect(worker).toMatch(/contentMutationStoreProvider\?\.\(env\)/)
    expect(worker).toContain('SERVICE_UNAVAILABLE')
  })

  it('returns media references from the Neon public listing projection', async () => {
    const row = {
      id: 'content_123', content_type: 'article', owner_user_id: 'user_123',
      creator_id: 'user_123', ip_id: null, state: 'PUBLISHED', scheduled_at: null,
      access_mode: 'PUBLIC', version: 2, revision: 2, slug: 'published-article',
      title: 'Published article', body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '["https://cdn.example.com/image.jpg"]',
      cover_ref: 'https://cdn.example.com/image.jpg', media_warning: null, etag: 'W/"2"',
      created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-01T12:01:00.000Z',
    }
    const calls: unknown[] = []
    const store = {
      async list(input: unknown) { calls.push(input); return [row] as never },
      async search() { return [] as never },
    }
    const page = await listContents(store, null, 20)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.mediaRefs).toEqual(['https://cdn.example.com/image.jpg'])
    expect(calls).toEqual([{
      cursor: null, limit: 21, creatorId: null, ownerUserId: null, contentType: null,
    }])
  })

  it('filters public content by creator through the Neon public list store', async () => {
    const row = {
      id: 'creator_content_123', content_type: 'article', owner_user_id: 'user_123',
      creator_id: 'user_123', ip_id: null, state: 'PUBLISHED', scheduled_at: null,
      access_mode: 'PUBLIC', version: 1, revision: 1, slug: 'creator-article',
      title: 'Creator article', body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]', cover_ref: null, media_warning: null, etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z', updated_at: '2026-10-02T12:01:00.000Z',
    }
    const calls: unknown[] = []
    const store = {
      async list(input: unknown) { calls.push(input); return [row] as never },
      async search() { return [] as never },
    }
    const page = await listContents(store, null, 6, 'user_123')
    expect(page.items[0]?.creatorId).toBe('user_123')
    expect(calls).toEqual([{
      cursor: null, limit: 7, creatorId: 'user_123', ownerUserId: null, contentType: null,
    }])
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

    const neonWorker = createW03ContentWorker({
      contentDetailReadStoreProvider: () => ({ getContent: async () => row } as never),
    })

    const response = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_public_123', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-public',
        },
      }),
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: 'content_public_123',
      creatorId: 'user_123',
      state: 'PUBLISHED',
      title: 'Public article',
    })
  }, {} as never)

  it('resolves a published content request by stable slug through Neon', async () => {
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
    let requestedContent: string | null = null
    const neonWorker = createW03ContentWorker({
      contentDetailReadStoreProvider: () => ({
        getContent: async (contentIdOrSlug: string) => { requestedContent = contentIdOrSlug; return row },
      } as never),
    })

    const response = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/' + encodeURIComponent(slug), {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-slug',
        },
      }),
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(requestedContent).toBe(slug)
    await expect(response.json()).resolves.toMatchObject({
      id: row.id,
      slug,
      title: row.title,
    })
  }, {} as never)

  it('does not expose non-published content to an anonymous detail request', async () => {
    const neonWorker = createW03ContentWorker({
      contentDetailReadStoreProvider: () => ({ getContent: async () => null } as never),
    })

    const response = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_private_123', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-private',
        },
      }),
      {} as never,
    )

    expect(response.status).toBe(404)
  }, {} as never)

})

  it('stores the full ContentRecord through Neon for update idempotency replay', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )
    const start = runtime.indexOf('export async function updateContent')
    const end = runtime.indexOf('\nexport async function rollbackContentRevision', start)
    const section = runtime.slice(start, end)
    expect(section).toContain('const idempotencyResponseBody = JSON.stringify(updated)')
    expect(section).toContain('await mutationStore.update({')
    expect(section).toContain('responseJson: idempotencyResponseBody,')
    expect(section).toContain('requestHash: hash,')
    expect(section).toContain('expectedVersion: content.version,')
    expect(section).toContain('expectedEtag: content.etag,')
    expect(section).toContain('revision,')
    expect(section).toContain('return updated')
    expect(section).not.toContain('insertCompletedIdempotency')
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
    expect(wrangler).not.toContain('"crons"')
    const w01Wrangler = readFileSync(
      resolve(process.cwd(), 'workers/W01-payload/wrangler.jsonc'),
      'utf8',
    )
    expect(w01Wrangler).toContain('"main": "src/worker.ts"')
    expect(w01Wrangler).toContain('"crons": [\n      "* * * * *"\n    ]')
    const w01Worker = readFileSync(
      resolve(process.cwd(), 'workers/W01-payload/src/worker.ts'),
      'utf8',
    )
    expect(w01Worker).toContain('openNextWorker.fetch')
    expect(w01Worker).toContain('async scheduled(controller: ScheduledController, env: ScheduledEnv)')
    expect(w01Worker).toContain('runAuthorizedScheduledPublish')
    const w03Index = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/index.ts'),
      'utf8',
    )
    expect(w03Index).toContain('/internal/content/scheduled-due')
    expect(w03Index).toContain('/internal/content/scheduled-publish/commit')
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

  it('records create, update and rollback history through their authoritative persistence transactions', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )
    for (const operation of ["operation: 'CREATE'", "operation: 'UPDATE'", "operation: 'ROLLBACK'"]) {
      expect(runtime).toContain(operation)
    }
    // The ROLLBACK event is emitted atomically by the PostgreSQL mutation store below.
    for (const marker of ['export async function listContentRevisions', 'export async function getContentRevision', 'export async function rollbackContentRevision']) {
      expect(runtime).toContain(marker)
    }

    const updateIndex = runtime.indexOf('export async function updateContent')
    const updateStoreWrite = runtime.indexOf('await mutationStore.update({', updateIndex)
    const updateRevision = runtime.indexOf('const revision: ContentRevision = {', updateIndex)
    const updateRevisionOperation = runtime.indexOf("operation: 'UPDATE'", updateRevision)
    const updateEnd = runtime.indexOf('\nexport async function rollbackContentRevision', updateIndex)
    const updateSection = runtime.slice(updateIndex, updateEnd)
    expect(updateIndex).toBeGreaterThanOrEqual(0)
    expect(updateRevision).toBeGreaterThan(updateIndex)
    expect(updateRevisionOperation).toBeGreaterThan(updateRevision)
    expect(updateStoreWrite).toBeGreaterThan(updateRevision)
    expect(updateSection).not.toContain('db.prepare')
    expect(updateSection).not.toContain('batchMutation')

    const revisionListStart = runtime.indexOf('export async function listContentRevisions')
    const revisionListEnd = runtime.indexOf('\nexport async function getContentRevision', revisionListStart)
    const revisionListSection = runtime.slice(revisionListStart, revisionListEnd)
    expect(revisionListSection).toContain('await readStore.list(')
    expect(revisionListSection).not.toContain('ContentD1')
    expect(revisionListSection).not.toContain('db.prepare')

    const revisionGetStart = runtime.indexOf('export async function getContentRevision')
    const revisionGetEnd = runtime.indexOf('\nexport function validateListFilters', revisionGetStart)
    const revisionGetSection = runtime.slice(revisionGetStart, revisionGetEnd)
    expect(revisionGetSection).toContain('await readStore.get(')
    expect(revisionGetSection).not.toContain('ContentD1')
    expect(revisionGetSection).not.toContain('db.prepare')

    const rollbackIndex = runtime.indexOf('export async function rollbackContentRevision')
    const rollbackEnd = runtime.indexOf('\nexport async function deleteContent', rollbackIndex)
    const rollbackSection = runtime.slice(rollbackIndex, rollbackEnd)
    const rollbackRevisionIndex = rollbackSection.indexOf('const rollbackRevision: ContentRevision = {')
    const rollbackOperation = rollbackSection.indexOf("operation: 'ROLLBACK'", rollbackRevisionIndex)
    expect(rollbackSection).toContain('await mutationStore.loadMutation(')
    expect(rollbackSection).toContain('await mutationStore.loadRevision(')
    expect(rollbackSection).toContain('await mutationStore.rollback({')
    expect(rollbackSection).not.toContain('ContentD1')
    expect(rollbackSection).not.toContain('db.prepare')
    expect(rollbackSection).not.toContain('batchMutation')
    expect(rollbackRevisionIndex).toBeGreaterThanOrEqual(0)
    expect(rollbackOperation).toBeGreaterThan(rollbackRevisionIndex)
    const postgresMutationStore = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-mutation-store-postgres.ts'),
      'utf8',
    )
    expect(postgresMutationStore).toContain("'content.revision.rolled_back'")
    expect(runtime).toContain("sourceAccessMode !== currentAccessMode")
    expect(runtime).toContain("verifiedCreatorId !== content.creatorId")
  })
})


it('maps an authoritative Neon compare-and-set failure to HTTP 412', async () => {
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
  const mutationStore = makeContentMutationStore(
    row,
    async () => { throw new ContentRuntimeError('PRECONDITION_FAILED', 412) },
  )
  await expect(updateContent(
    'user_cas_412',
    'content_cas_412_123',
    { contentType: 'article', title: 'Updated title', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"2"',
    'content-cas-412-idem',
    mutationStore,
  )).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
})

it('surfaces unavailable Neon persistence without falling back to D1', async () => {
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
  }
  const mutationStore = makeContentMutationStore(
    row,
    async () => { throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503) },
  )
  await expect(updateContent(
    'user_unique',
    'content_unique_123',
    { contentType: 'article', title: 'Updated title', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"1"',
    'content-unique-idem',
    mutationStore,
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
  let updateCalled = false
  const mutationStore = makeContentMutationStore(row, async () => { updateCalled = true })
  await expect(updateContent(
    'user_review_lock',
    'content_review_lock_123',
    { contentType: 'article', title: 'Attempted edit during review', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"2"',
    'review-lock-idem',
    mutationStore,
  )).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  expect(updateCalled).toBe(false)
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
  const db = makeContentMutationStore(content)
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
  const db = undefined as never
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
  const store = {
    loadIdempotency: async () => ({
      idem_id: 'idem_123',
      idem_owner_user_id: 'user_123',
      idem_request_hash: hashHex,
      idem_status: 'COMPLETED',
      idem_response_status: 201,
      idem_response_json: JSON.stringify(original),
      idem_expires_at: '2026-10-08T07:00:00.000Z',
    }),
    allocateContentId: async () => { throw new Error('allocator must not run on idempotency replay') },
    create: async () => { throw new Error('create must not run on idempotency replay') },
  } as never
  const result = await createContent(
    'user_123',
    { contentType: 'article', title: 'Draft content', bodyRef: 'https://cdn.example.com/body.json', mediaRefs: [], coverRef: null },
    'create-key',
    new Date('2026-10-07T08:00:00.000Z'),
    'runtime',
    undefined,
    store,
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

    let transitionCalled = false
    const db = makeContentMutationStore({
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
    }, async () => undefined, async () => {
      transitionCalled = true
    })

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

    expect(transitionCalled).toBe(false)
  })
})

describe('W03 username redirect eligibility', () => {
  it('uses only W03-owned published public content and accepts only the W01 service caller', async () => {
    let eligibleValue = true
    const contextCalls: string[] = []
    const allowLimiter = { limit: async () => ({ success: true }) }
    const neonWorker = createW03ContentWorker({
      contentContextReadStoreProvider: () => ({
        hasPublicCreatorContent: async (ownerUserId: string) => {
          contextCalls.push(ownerUserId)
          return eligibleValue
        },
      } as never),
    })
    const env = {
      CONTENT_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      CONTENT_PUBLIC_READ_LIMITER: allowLimiter,
      CONTENT_MUTATION_LIMITER: allowLimiter,
    } as never
    const request = (caller = 'W01', owner = 'user_123', extra: Record<string, string> = {}) =>
      new Request('https://luckread-w03.internal/internal/content/username-redirect-eligibility/' + owner, {
        headers: {
          'X-LuckRead-Caller': caller,
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'username-redirect-eligibility-test',
          ...extra,
        },
      })
    const response = await neonWorker.fetch(request(), env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { eligible: true } })
    expect(contextCalls).toEqual(['user_123'])
    eligibleValue = false
    const empty = await neonWorker.fetch(request(), env)
    await expect(empty.json()).resolves.toMatchObject({ data: { eligible: false } })
    const readsBeforeReject = contextCalls.length
    const wrongCaller = await neonWorker.fetch(request('W05'), env)
    expect(wrongCaller.status).toBe(403)
    const forwardedCookie = await neonWorker.fetch(request('W01', 'user_123', { Cookie: 'session=secret' }), env)
    expect(forwardedCookie.status).toBe(403)
    expect(contextCalls).toHaveLength(readsBeforeReject)
  })

  it('exposes published owner identity only through the W01 internal author context', async () => {
    const contentRow = {
      id: 'content_public_123',
      content_type: 'post',
      owner_user_id: 'w02-user-123',
      creator_id: 'creator-identity-456',
      ip_id: null,
      state: 'PUBLISHED',
      scheduled_at: null,
      access_mode: 'PUBLIC',
      version: 1,
      revision: 1,
      slug: 'public-post-123',
      title: 'Public post',
      body_ref: 'body-ref',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    }
    let row: typeof contentRow | null = { ...contentRow }
    let contextReads = 0
    let detailReads = 0
    const allowLimiter = { limit: async () => ({ success: true }) }
    const neonWorker = createW03ContentWorker({
      contentContextReadStoreProvider: () => ({
        getPublishedContentAuthorContext: async (reference: string) => {
          contextReads += 1
          if (!row) throw new ContentRuntimeError('NOT_FOUND', 404)
          expect(reference).toBe('content_public_123')
          return { contentId: row.id, ownerUserId: row.owner_user_id }
        },
      } as never),
      contentDetailReadStoreProvider: () => ({
        getContent: async (reference: string, principalUserId: string | null) => {
          detailReads += 1
          expect(reference).toBe('content_public_123')
          expect(principalUserId).toBeNull()
          return row
        },
      } as never),
    })
    const env = {
      CONTENT_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      CONTENT_PUBLIC_READ_LIMITER: allowLimiter,
      CONTENT_MUTATION_LIMITER: allowLimiter,
    } as never

    const makeRequest = (
      path: string,
      caller = 'W01',
      method = 'GET',
      extraHeaders: Record<string, string> = {},
    ) => new Request('https://luckread-w03.internal' + path, {
      method,
      headers: {
        'X-LuckRead-Caller': caller,
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'public-author-context-test',
        ...extraHeaders,
      },
    })

    const authorPath = '/internal/content/contents/content_public_123/public-author-context'
    const authorResponse = await neonWorker.fetch(makeRequest(authorPath), env)
    expect(authorResponse.status).toBe(200)
    await expect(authorResponse.json()).resolves.toMatchObject({
      data: { contentId: 'content_public_123', ownerUserId: 'w02-user-123' },
    })
    expect(contextReads).toBe(1)

    const publicDetail = await neonWorker.fetch(makeRequest('/internal/content/contents/content_public_123'), env)
    expect(publicDetail.status).toBe(200)
    const publicDetailBody = await publicDetail.json() as Record<string, unknown>
    expect(publicDetailBody).not.toHaveProperty('ownerUserId')
    expect(detailReads).toBe(1)

    const readsBeforeReject = contextReads
    const wrongCaller = await neonWorker.fetch(makeRequest(authorPath, 'W05'), env)
    expect(wrongCaller.status).toBe(403)
    const forwardedCookie = await neonWorker.fetch(
      makeRequest(authorPath, 'W01', 'GET', { Cookie: 'session=must-not-cross-service-binding' }), env)
    expect(forwardedCookie.status).toBe(403)
    const forwardedPrincipal = await neonWorker.fetch(
      makeRequest(authorPath, 'W01', 'GET', { 'X-LuckRead-Principal-User-Id': 'spoofed-user' }), env)
    expect(forwardedPrincipal.status).toBe(403)
    const wrongMethod = await neonWorker.fetch(makeRequest(authorPath, 'W01', 'POST'), env)
    expect(wrongMethod.status).toBe(405)
    expect(contextReads).toBe(readsBeforeReject)

    row = null
    const unpublishedOrMissing = await neonWorker.fetch(makeRequest(authorPath), env)
    expect(unpublishedOrMissing.status).toBe(404)
  })
})

describe('creator-selected sensitive media warning', () => {
  const base = {
    contentType: 'post',
    title: 'A post with media',
    bodyRef: 'https://img.luckread.com/body/post.txt',
    mediaRefs: ['https://img.luckread.com/media/post.webp'],
    coverRef: 'https://img.luckread.com/media/post.webp',
  }

  it('accepts only the supported warning categories on media posts', () => {
    expect(validateInput({ ...base, mediaWarning: 'NUDITY' }).mediaWarning).toBe('NUDITY')
    expect(validateInput({ ...base, mediaWarning: 'VIOLENCE' }).mediaWarning).toBe('VIOLENCE')
    expect(validateInput({ ...base, mediaWarning: 'SENSITIVE' }).mediaWarning).toBe('SENSITIVE')
    expect(validateInput(base).mediaWarning).toBeUndefined()
    expect(validateInput({ ...base, mediaWarning: null }).mediaWarning).toBeNull()
  })

  it('rejects unsupported categories, non-post warnings, and warnings without attached media', () => {
    for (const mediaWarning of ['POLITICS', 'UNKNOWN', 1, {}]) {
      expect(() => validateInput({ ...base, mediaWarning })).toThrowError(ContentRuntimeError)
    }
    expect(() => validateInput({ ...base, contentType: 'article', mediaWarning: 'NUDITY' }))
      .toThrowError(ContentRuntimeError)
    expect(() => validateInput({ ...base, mediaRefs: [], coverRef: null, mediaWarning: 'SENSITIVE' }))
      .toThrowError(ContentRuntimeError)
  })

  it('redacts warning metadata together with private media in member-only previews', () => {
    const content: ContentRecord = {
      id: 'sensitive-warning-content',
      contentType: 'post',
      ownerUserId: 'owner_1',
      creatorId: 'creator_1',
      ipId: null,
      state: 'PUBLISHED',
      revision: 1,
      updatedAt: '2026-11-05T00:00:00.000Z',
      createdAt: '2026-11-05T00:00:00.000Z',
      scheduledAt: null,
      accessMode: 'MEMBERS_ONLY',
      version: 1,
      etag: 'W/"1"',
      slug: 'sensitive-warning-content',
      title: 'Private post',
      bodyRef: 'https://img.luckread.com/body/private.txt',
      mediaRefs: ['https://img.luckread.com/media/private.webp'],
      coverRef: 'https://img.luckread.com/media/private.webp',
      mediaWarning: 'NUDITY',
    }
    expect(publicContent({ ...content, accessGranted: false })).toMatchObject({
      mediaRefs: [],
      coverRef: null,
      mediaWarning: null,
    })
    expect(publicContent({ ...content, accessGranted: true })).toMatchObject({
      mediaWarning: 'NUDITY',
    })
  })

  it('adds a nullable, database-constrained warning to content and revision history', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0015_content_media_warning.sql'),
      'utf8',
    )
    expect(migration).toContain('ALTER TABLE contents')
    expect(migration).toContain('ALTER TABLE content_revisions')
    expect(migration).toContain("'NUDITY', 'VIOLENCE', 'SENSITIVE'")
  })
})


describe('W03 Neon canonical content detail access behavior', () => {
  it('requires the Neon detail read store for the canonical content lookup', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )
    const start = runtime.indexOf('export async function getContent(')
    const end = runtime.indexOf('\nexport async function getPublishedContentAuthorContext', start)
    const section = runtime.slice(start, end)
    expect(section).toContain('await readStore.getContent(contentId, principalUserId)')
    expect(section).not.toContain('ContentD1')
    expect(section).not.toContain('db.prepare')
  })

  it('keeps W07 membership checks and member-only body redaction after Neon lookup', async () => {
    const row = {
      id: 'content_member_1',
      content_type: 'article' as const,
      owner_user_id: 'owner_1',
      creator_id: 'creator_1',
      ip_id: null,
      state: 'PUBLISHED' as const,
      scheduled_at: null,
      access_mode: 'MEMBERS_ONLY' as const,
      version: 1,
      revision: 1,
      slug: 'member-article',
      title: 'Private article title',
      body_ref: 'private-body-ref',
      media_refs_json: '["private-media-ref"]',
      cover_ref: 'private-cover-ref',
      media_warning: null,
      etag: 'W/"1"',
      created_at: '2026-10-30T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    }
    const calls: unknown[][] = []
    const readStore = {
      async getContent(contentIdOrSlug: string, principalUserId: string | null) {
        calls.push([contentIdOrSlug, principalUserId])
        return row
      },
    }
    const denied = await getContent(readStore as never, 'member-article', 'reader_1', async creatorId => {
      expect(creatorId).toBe('creator_1')
      return false
    })
    expect(denied).toMatchObject({
      accessGranted: false,
      accessMode: 'MEMBERS_ONLY',
      title: '会员专享内容',
      bodyRef: '',
      mediaRefs: [],
      coverRef: null,
    })

    const entitled = await getContent(readStore as never, 'member-article', 'reader_1', async creatorId => {
      expect(creatorId).toBe('creator_1')
      return true
    })
    expect(entitled).toMatchObject({
      accessGranted: true,
      accessMode: 'MEMBERS_ONLY',
      title: 'Private article title',
      bodyRef: 'private-body-ref',
      mediaRefs: ['private-media-ref'],
      coverRef: 'private-cover-ref',
    })
    expect(calls).toEqual([
      ['member-article', 'reader_1'],
      ['member-article', 'reader_1'],
    ])
  })

  it('fails closed when the Neon content detail reader is unavailable', async () => {
    let prepareCalled = false
    const prepare = () => {
      prepareCalled = true
      throw new Error('content detail must not read D1')
    }
    const worker = createW03ContentWorker()
    const response = await worker.fetch(
      new Request('https://w03.internal/internal/content/contents/content_1', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'content-detail-neon-store-unavailable',
        },
      }),
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(prepareCalled).toBe(false)
  }, {} as never)

  it('keeps anonymous and owner principals explicit at the reader boundary', async () => {
    const principals: Array<string | null> = []
    const row = {
      id: 'content_public_1',
      content_type: 'post' as const,
      owner_user_id: 'owner_1',
      creator_id: 'owner_1',
      ip_id: null,
      state: 'PUBLISHED' as const,
      scheduled_at: null,
      access_mode: 'PUBLIC' as const,
      version: 1,
      revision: 1,
      slug: 'public-post',
      title: 'Public post',
      body_ref: 'body',
      media_refs_json: '[]',
      cover_ref: null,
      media_warning: null,
      etag: 'W/"1"',
      created_at: '2026-10-30T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    }
    const readStore = {
      async getContent(_contentIdOrSlug: string, principalUserId: string | null) {
        principals.push(principalUserId)
        return row
      },
    }
    await getContent(readStore as never, 'public-post', null)
    await getContent(readStore as never, 'public-post', 'owner_1')
    expect(principals).toEqual([null, 'owner_1'])
  })
})


describe('W03 Neon creator content list pagination', () => {
  it('uses the injected owner-scoped read store for every creator filter path', async () => {
    const row = {
      id: 'content_1',
      content_type: 'video' as const,
      owner_user_id: 'owner_1',
      creator_id: 'creator_1',
      ip_id: null,
      state: 'SCHEDULED' as const,
      scheduled_at: '2026-11-18T12:00:00.000Z',
      access_mode: 'MEMBERS_ONLY' as const,
      version: 4,
      revision: 3,
      slug: 'scheduled-video',
      title: 'Scheduled video',
      body_ref: 'body-ref',
      media_refs_json: '["media-ref"]',
      cover_ref: 'cover-ref',
      media_warning: 'SENSITIVE' as const,
      etag: 'W/"4"',
      created_at: '2026-11-10T10:00:00.000Z',
      updated_at: '2026-11-11T11:00:00.000Z',
    }
    const calls: unknown[][] = []
    const readStore = {
      async list(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number, filters: { status?: string; contentType?: string }) {
        calls.push([ownerUserId, cursor, limit, filters])
        return [row, { ...row, id: 'content_2', updated_at: '2026-11-10T10:00:00.000Z' }]
      },
    }
    const result = await listCreatorContents(
      readStore,
      'owner_1',
      null,
      1,
      { status: 'SCHEDULED', contentType: 'video' },
    )

    expect(calls).toEqual([['owner_1', null, 2, { status: 'SCHEDULED', contentType: 'video' }]])
    expect(result).toMatchObject({
      items: [{
        id: 'content_1',
        ownerUserId: 'owner_1',
        contentType: 'video',
        state: 'SCHEDULED',
        scheduledAt: '2026-11-18T12:00:00.000Z',
        accessMode: 'MEMBERS_ONLY',
        mediaWarning: 'SENSITIVE',
        mediaRefs: ['media-ref'],
      }],
      hasMore: true,
    })
    expect(decodeScopedCursor(
      result.nextCursor!,
      JSON.stringify({
        type: 'creator-contents',
        ownerUserId: 'owner_1',
        status: 'SCHEDULED',
        contentType: 'video',
      }),
    )).toEqual({ updatedAt: '2026-11-11T11:00:00.000Z', id: 'content_1' })
  })
})
