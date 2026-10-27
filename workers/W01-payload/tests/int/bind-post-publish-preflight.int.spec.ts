import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  callW03Content: vi.fn(),
  validateOwnedPostMediaReferences: vi.fn(),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock('../../src/content/w03-content-client.js', () => ({
  callW03Content: mocks.callW03Content,
}))

vi.mock('../../src/content/validate-owned-post-media-references.js', () => ({
  validateOwnedPostMediaReferences: mocks.validateOwnedPostMediaReferences,
}))

import { bindPreflightToStoredPost } from '../../src/content/bind-post-publish-preflight.js'

const bodyText = 'The canonical text stored in the owner-only draft asset.'
const storedPost = {
  contentType: 'post',
  state: 'DRAFT',
  title: 'Authoritative title',
  bodyRef: 'https://img.luckread.com/media/body%20one.txt',
  mediaRefs: ['https://img.luckread.com/media/photo.png'],
  coverRef: 'https://img.luckread.com/media/photo.png',
}

const makeRequest = () => new Request('https://api.luckread.com/v1/contents/content-123/state', {
  method: 'POST',
  headers: {
    authorization: 'Bearer do-not-forward-to-media-host',
    cookie: 'better-auth.session_token=do-not-forward-to-media-host',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    to: 'PUBLISHED',
    preflight: {
      contentType: 'post',
      title: 'Client-supplied title',
      body: 'Client-supplied body',
      mediaRefs: [],
      coverRef: null,
    },
  }),
})

const makeR2Object = (
  text: string,
  contentType = 'text/plain;charset=utf-8',
) => {
  const bytes = new TextEncoder().encode(text)
  return {
    size: bytes.byteLength,
    httpMetadata: { contentType },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
  }
}

const makeErrorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} } }, { status })

async function runBinding() {
  return bindPreflightToStoredPost(
    makeRequest(),
    'content-123',
    { userId: 'better-auth-user-123', layer: 'L2' },
    {
      to: 'PUBLISHED',
      preflight: {
        contentType: 'post',
        title: 'Client-supplied title',
        body: 'Client-supplied body',
        mediaRefs: [],
        coverRef: null,
      },
    },
    makeErrorResponse,
  )
}

describe('W01 private draft body preflight', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.callW03Content.mockResolvedValue(Response.json(storedPost))
    mocks.validateOwnedPostMediaReferences.mockResolvedValue({ valid: true })
    mocks.getCloudflareContext.mockResolvedValue({ env: { R2: { get: vi.fn() } } })
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('reads the owned private draft body through the existing R2 binding without sending credentials to img.luckread.com', async () => {
    const get = vi.fn(async (key: string) => makeR2Object(bodyText))
    mocks.getCloudflareContext.mockResolvedValue({ env: { R2: { get } } })

    const result = await runBinding()

    expect(result).toMatchObject({
      to: 'PUBLISHED',
      preflight: {
        contentType: 'post',
        title: 'Authoritative title',
        body: bodyText,
        mediaRefs: storedPost.mediaRefs,
        coverRef: storedPost.coverRef,
      },
    })
    expect(mocks.validateOwnedPostMediaReferences).toHaveBeenCalledWith(
      'better-auth-user-123',
      storedPost,
      'https://api.luckread.com',
    )
    expect(get).toHaveBeenCalledWith('media/body one.txt')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.callW03Content).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the R2 object is not plain text', async () => {
    const get = vi.fn(async (_key: string) => makeR2Object('<html>not a post body</html>', 'text/html'))
    mocks.getCloudflareContext.mockResolvedValue({ env: { R2: { get } } })

    const result = await runBinding()

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(422)
    expect(await (result as Response).json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', message: 'Stored post body is empty or exceeds the verification limit' },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects oversized R2 body assets before reading them into memory', async () => {
    const cancel = vi.fn(async () => undefined)
    const get = vi.fn(async () => ({
      size: 16_385,
      httpMetadata: { contentType: 'text/plain;charset=utf-8' },
      body: new ReadableStream<Uint8Array>({ cancel }),
    }))
    mocks.getCloudflareContext.mockResolvedValue({ env: { R2: { get } } })

    const result = await runBinding()

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(422)
    expect(cancel).toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never forwards user credentials to an unapproved LuckRead subdomain', async () => {
    mocks.callW03Content.mockResolvedValue(Response.json({
      ...storedPost,
      bodyRef: 'https://unexpected.luckread.com/media/body.txt',
    }))
    const get = vi.fn()
    mocks.getCloudflareContext.mockResolvedValue({ env: { R2: { get } } })

    const result = await runBinding()

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(422)
    expect(get).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps authenticated same-origin development reads and refuses redirects', async () => {
    mocks.callW03Content.mockResolvedValue(Response.json({
      ...storedPost,
      bodyRef: 'https://api.luckread.com/private-media/body.txt',
    }))
    fetchSpy.mockResolvedValueOnce(new Response(bodyText, {
      status: 200,
      headers: { 'content-type': 'text/plain;charset=utf-8' },
    }))

    const result = await runBinding()

    expect(result).toMatchObject({
      preflight: { body: bodyText, title: 'Authoritative title' },
    })
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer do-not-forward-to-media-host')
    expect(headers.get('cookie')).toBe('better-auth.session_token=do-not-forward-to-media-host')
    expect(init.redirect).toBe('manual')
  })
})
