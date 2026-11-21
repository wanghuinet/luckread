import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  callW03Content: vi.fn(),
  resolveOptionalCookieContentPrincipal: vi.fn(),
  payloadMediaGet: vi.fn(),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock('../../src/content/w03-content-client.js', () => ({
  callW03Content: mocks.callW03Content,
  resolveOptionalCookieContentPrincipal: mocks.resolveOptionalCookieContentPrincipal,
}))
vi.mock('../../src/app/(payload)/api/[...slug]/route.js', () => ({
  GET: mocks.payloadMediaGet,
}))

import { GET } from '../../src/app/api/media-delivery/[...key]/route.js'

afterEach(() => {
  vi.clearAllMocks()
})

const mediaContext = {
  params: Promise.resolve({ key: ['uploads', 'photo.png'] }),
}

const makeBucket = () => {
  const metadata = {
    size: 3,
    httpMetadata: { contentType: 'image/png' },
    httpEtag: '"asset-v1"',
    uploaded: new Date('2026-10-30T00:00:00.000Z'),
    writeHttpMetadata(headers: Headers) {
      headers.set('content-type', 'image/png')
    },
  }
  const bucket = {
    head: vi.fn(async () => metadata),
    get: vi.fn(async () => ({
      ...metadata,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.close()
        },
      }),
    })),
  }
  mocks.getCloudflareContext.mockResolvedValue({ env: { R2: bucket } })
  return bucket
}

describe('W01 member-only media delivery', () => {
  it('streams media only after W03 confirms active membership and keeps the response private', async () => {
    const principal = { userId: 'subscriber_1', layer: 'L2' }
    const bucket = makeBucket()
    mocks.resolveOptionalCookieContentPrincipal.mockResolvedValue(principal)
    mocks.callW03Content.mockResolvedValue(Response.json({
      data: { isPublic: false, isMemberContent: true, allowed: true },
      requestId: 'req-member-allowed',
    }))

    const response = await GET(new Request('https://img.luckread.com/uploads/photo.png', {
      headers: { Cookie: 'session=browser-session' },
    }), mediaContext)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer)
    expect(bucket.head).toHaveBeenCalledWith('uploads/photo.png')
    expect(bucket.get).toHaveBeenCalledOnce()
    expect(mocks.callW03Content).toHaveBeenCalledWith(expect.objectContaining({
      pathname: expect.stringContaining('/internal/content/public-media-reference?url='),
      principal,
    }))
    expect(mocks.payloadMediaGet).not.toHaveBeenCalled()
  })

  it('does not fall back to Payload owner delivery when a member-only reference is denied', async () => {
    const bucket = makeBucket()
    mocks.resolveOptionalCookieContentPrincipal.mockResolvedValue({
      userId: 'non_member_1',
      layer: 'L2',
    })
    mocks.callW03Content.mockResolvedValue(Response.json({
      data: { isPublic: false, isMemberContent: true, allowed: false },
      requestId: 'req-member-denied',
    }))

    const response = await GET(new Request('https://img.luckread.com/uploads/photo.png', {
      headers: { Cookie: 'session=browser-session' },
    }), mediaContext)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(bucket.head).not.toHaveBeenCalled()
    expect(mocks.payloadMediaGet).not.toHaveBeenCalled()
  })

  it('preserves the existing public-media revalidation policy for anonymous readers', async () => {
    const bucket = makeBucket()
    mocks.resolveOptionalCookieContentPrincipal.mockResolvedValue(null)
    mocks.callW03Content.mockResolvedValue(Response.json({
      data: { isPublic: true, isMemberContent: false, allowed: true },
      requestId: 'req-public-media',
    }))

    const response = await GET(new Request('https://img.luckread.com/uploads/photo.png'), mediaContext)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(bucket.get).toHaveBeenCalledOnce()
    expect(mocks.payloadMediaGet).not.toHaveBeenCalled()
  })

  it('keeps standalone private uploads on the existing Payload owner path', async () => {
    mocks.resolveOptionalCookieContentPrincipal.mockResolvedValue(null)
    mocks.callW03Content.mockResolvedValue(Response.json({
      data: { isPublic: false, isMemberContent: false, allowed: false },
      requestId: 'req-private-upload',
    }))
    mocks.payloadMediaGet.mockResolvedValue(new Response('owner-private-asset', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }))

    const response = await GET(new Request('https://img.luckread.com/uploads/photo.png', {
      headers: { Cookie: 'session=owner-session' },
    }), mediaContext)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.text()).resolves.toBe('owner-private-asset')
    expect(mocks.payloadMediaGet).toHaveBeenCalledOnce()
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
  })

  it('fails closed when W03 returns a malformed visibility decision', async () => {
    mocks.resolveOptionalCookieContentPrincipal.mockResolvedValue(null)
    mocks.callW03Content.mockResolvedValue(Response.json({
      data: { isPublic: false, allowed: true },
      requestId: 'req-malformed-visibility',
    }))

    const response = await GET(new Request('https://img.luckread.com/uploads/photo.png'), mediaContext)

    expect(response.status).toBe(503)
    expect(mocks.payloadMediaGet).not.toHaveBeenCalled()
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
  })
})
