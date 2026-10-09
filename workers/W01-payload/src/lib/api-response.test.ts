import { describe, expect, it } from 'vitest'
import { apiErrorResponse, appendRequestIdToJsonResponse, normalizeApiErrorResponse } from './api-response.js'

describe('canonical API response helpers', () => {
  it('emits the locked common error envelope and a schema-valid request ID', async () => {
    const response = apiErrorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        details: {},
      },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]{1,124}$/),
    })
    const body = await response.clone().json() as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId'])
  })

  it('maps noncanonical Payload validation status and failure bodies to canonical errors', async () => {
    const upstream = Response.json(
      { errors: [{ message: 'Payload internal validation text' }] },
      { status: 400 },
    )
    const response = normalizeApiErrorResponse(upstream, 'Media service unavailable')
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        details: {},
      },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]{1,124}$/),
    })
  })

  it('maps upstream not-found and server errors without leaking upstream bodies', async () => {
    const notFound = normalizeApiErrorResponse(new Response('secret payload error', { status: 404 }), 'Media service unavailable')
    expect(notFound.status).toBe(404)
    await expect(notFound.json()).resolves.toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Resource not found', details: {} },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]{1,124}$/),
    })

    const failure = normalizeApiErrorResponse(new Response('secret backend error', { status: 500 }), 'Session service unavailable')
    expect(failure.status).toBe(503)
    await expect(failure.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable', details: {} },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]{1,124}$/),
    })
  })

  it('adds request IDs to JSON success responses while preserving empty 204 responses', async () => {
    const response = await appendRequestIdToJsonResponse(Response.json({ id: 'media_1' }))
    await expect(response.json()).resolves.toMatchObject({
      id: 'media_1',
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]{1,124}$/),
    })

    const noContent = new Response(null, { status: 204 })
    expect(await appendRequestIdToJsonResponse(noContent)).toBe(noContent)
  })
})
