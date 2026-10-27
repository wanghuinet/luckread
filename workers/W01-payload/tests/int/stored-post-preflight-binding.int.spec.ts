import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getCloudflareContextMock = vi.hoisted(() => vi.fn())

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: getCloudflareContextMock,
}))

import { bindPreflightToStoredPost } from '../../src/content/bind-post-publish-preflight.js'
import { callW03Content } from '../../src/content/w03-content-client.js'
import { validateOwnedPostMediaReferences } from '../../src/content/validate-owned-post-media-references.js'

vi.mock('../../src/content/validate-owned-post-media-references.js', () => ({
  validateOwnedPostMediaReferences: vi.fn(),
}))

vi.mock('../../src/content/w03-content-client.js', () => ({
  callW03Content: vi.fn(),
}))

const callW03ContentMock = vi.mocked(callW03Content)
const validateMediaReferencesMock = vi.mocked(validateOwnedPostMediaReferences)

const makeErrorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status })

const makeRequest = (headers?: HeadersInit) =>
  new Request('https://api.luckread.com/v1/contents/post-1/state', { method: 'POST', headers })

const principal = { userId: 'author-1', layer: 'L3' }

const submitted = {
  to: 'PUBLISHED',
  preflight: {
    contentType: 'post',
    title: 'browser title',
    body: 'browser-supplied body must not be trusted',
    mediaRefs: ['https://attacker.example/forged.png'],
    coverRef: 'https://attacker.example/forged-cover.png',
    aiMode: 'outline',
    humanContribution: 'substantial',
  },
}

const makeR2Object = (text: string, contentType = 'text/plain;charset=utf-8') => {
  const bytes = new TextEncoder().encode(text)
  return {
    size: bytes.byteLength,
    httpMetadata: { contentType },
    body: new Response(bytes).body!,
  }
}

const storedPost = (overrides: Record<string, unknown> = {}) => ({
  id: 'post-1',
  contentType: 'post',
  state: 'DRAFT',
  title: 'authoritative stored title',
  bodyRef: 'https://img.luckread.com/media/post-body.txt',
  mediaRefs: ['https://img.luckread.com/media/photo.png'],
  coverRef: null as string | null,
  ...overrides,
})

describe('bind direct social post publishing to the stored body asset', () => {
  beforeEach(() => {
    callW03ContentMock.mockReset()
    validateMediaReferencesMock.mockReset()
    validateMediaReferencesMock.mockResolvedValue({ valid: true })
    getCloudflareContextMock.mockReset()
    getCloudflareContextMock.mockResolvedValue({
      env: { R2: { get: vi.fn(async () => makeR2Object('authoritative body stored in LuckRead media')) } },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replaces browser-supplied title/body/media with W03 metadata and the stored body file', async () => {
    callW03ContentMock.mockResolvedValue(new Response(JSON.stringify(storedPost()), { status: 200 }))
    const r2Get = vi.fn(async (key: string) => makeR2Object('authoritative body stored in LuckRead media'))
    getCloudflareContextMock.mockResolvedValue({ env: { R2: { get: r2Get } } })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await bindPreflightToStoredPost(
      makeRequest(),
      'post-1',
      principal,
      submitted,
      makeErrorResponse,
    ) as typeof submitted

    expect(callW03ContentMock).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/internal/content/contents/post-1',
      method: 'GET',
      principal,
    }))
    expect(r2Get).toHaveBeenCalledWith('media/post-body.txt')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.to).toBe('PUBLISHED')
    expect(result.preflight.title).toBe('authoritative stored title')
    expect(result.preflight.body).toBe('authoritative body stored in LuckRead media')
    expect(result.preflight.mediaRefs).toEqual(['https://img.luckread.com/media/photo.png'])
    expect(result.preflight.coverRef).toBeNull()
    expect(result.preflight.body).not.toBe(submitted.preflight.body)
  })

  it('rejects stored media references that no longer resolve to media owned by the author', async () => {
    callW03ContentMock.mockResolvedValue(new Response(JSON.stringify(storedPost()), { status: 200 }))
    validateMediaReferencesMock.mockResolvedValue({
      valid: false,
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Post media references must point to existing media owned by the current account',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await bindPreflightToStoredPost(
      makeRequest(),
      'post-1',
      principal,
      submitted,
      makeErrorResponse,
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(422)
    expect(await (result as Response).json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards owner credentials for same-origin private Payload media reads', async () => {
    callW03ContentMock.mockResolvedValue(new Response(JSON.stringify(storedPost({
      bodyRef: '/api/media/file/post-body.txt',
    })), { status: 200 }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('authoritative body stored in private media', { status: 200 }),
    )
    const request = makeRequest({
      authorization: 'Bearer creator-session-token',
      cookie: 'better-auth.session_token=creator-session-cookie',
    })

    const result = await bindPreflightToStoredPost(
      request,
      'post-1',
      principal,
      submitted,
      makeErrorResponse,
    )
    expect(result).not.toBeInstanceOf(Response)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.luckread.com/api/media/file/post-body.txt',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    )
    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer creator-session-token')
    expect(headers.get('cookie')).toBe('better-auth.session_token=creator-session-cookie')
  })

  it('rejects non-canonical media origins and video delivery URLs as post-body references', async () => {
    for (const bodyRef of [
      'https://img.luckread.com:8443/media/post-body.txt',
      'https://video.luckread.com/media/post-body.txt',
    ]) {
      callW03ContentMock.mockResolvedValueOnce(new Response(JSON.stringify(storedPost({ bodyRef })), { status: 200 }))
      const r2Get = vi.fn()
      getCloudflareContextMock.mockResolvedValueOnce({ env: { R2: { get: r2Get } } })

      const result = await bindPost()

      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(422)
      expect(r2Get).not.toHaveBeenCalled()
    }
  })

  it('rejects an unapproved LuckRead subdomain without forwarding owner credentials', async () => {
    callW03ContentMock.mockResolvedValue(new Response(JSON.stringify(storedPost({
      bodyRef: 'https://unexpected.luckread.com/media/post-body.txt',
    })), { status: 200 }))
    const r2Get = vi.fn()
    getCloudflareContextMock.mockResolvedValue({ env: { R2: { get: r2Get } } })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const request = makeRequest({
      authorization: 'Bearer creator-session-token',
      cookie: 'better-auth.session_token=creator-session-cookie',
    })

    const result = await bindPreflightToStoredPost(
      request,
      'post-1',
      principal,
      submitted,
      makeErrorResponse,
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(422)
    expect(r2Get).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed instead of fetching an untrusted bodyRef', async () => {
    callW03ContentMock.mockResolvedValue(new Response(JSON.stringify(storedPost({
      bodyRef: 'https://attacker.example/steal',
    })), { status: 200 }))
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await bindPreflightToStoredPost(
      makeRequest(),
      'post-1',
      principal,
      submitted,
      makeErrorResponse,
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(422)
    expect(await (result as Response).json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects redirects and oversized stored body files from same-origin development reads', async () => {
    callW03ContentMock.mockResolvedValue(new Response(JSON.stringify(storedPost({
      bodyRef: '/api/media/file/post-body.txt',
    })), { status: 200 }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://attacker.example/body' } }),
    )

    const redirected = await bindPreflightToStoredPost(
      makeRequest(),
      'post-1',
      principal,
      submitted,
      makeErrorResponse,
    )
    expect(redirected).toBeInstanceOf(Response)
    expect((redirected as Response).status).toBe(422)

    vi.restoreAllMocks()
    callW03ContentMock.mockResolvedValue(new Response(JSON.stringify(storedPost({
      bodyRef: '/api/media/file/post-body.txt',
    })), { status: 200 }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('x'.repeat(16_385), {
        status: 200,
        headers: { 'content-type': 'text/plain;charset=utf-8' },
      }),
    )
    const oversized = await bindPreflightToStoredPost(
      makeRequest(),
      'post-1',
      principal,
      submitted,
      makeErrorResponse,
    )
    expect(oversized).toBeInstanceOf(Response)
    expect((oversized as Response).status).toBe(422)
  })

  it('leaves review submissions alone and does not apply post binding to stored article content', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const reviewSubmission = { ...submitted, to: 'PENDING_REVIEW' }

    const reviewResult = await bindPreflightToStoredPost(
      makeRequest(),
      'post-1',
      principal,
      reviewSubmission,
      makeErrorResponse,
    )
    expect(reviewResult).toBe(reviewSubmission)
    expect(callW03ContentMock).not.toHaveBeenCalled()

    const articleSubmission = {
      ...submitted,
      preflight: { ...submitted.preflight, contentType: 'article' },
    }
    callW03ContentMock.mockResolvedValueOnce(new Response(JSON.stringify(storedPost({
      contentType: 'article',
      state: 'APPROVED',
    })), { status: 200 }))

    const articleResult = await bindPreflightToStoredPost(
      makeRequest(),
      'post-1',
      principal,
      articleSubmission,
      makeErrorResponse,
    )
    expect(articleResult).toBe(articleSubmission)
    expect(callW03ContentMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
