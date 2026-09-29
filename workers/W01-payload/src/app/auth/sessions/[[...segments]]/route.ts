import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import { readVerifiedPayloadTokenVersion } from '../../../../auth/payload-access-token.js'

type W02Service = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type W02Error = {
  error?: {
    code?: string
  }
}

type AuthenticatedSubject = {
  userId: string
  sessionId: string
  tokenVersion: number
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

const errorResponse = (status: number, code: string, message: string) =>
  json(
    {
      error: {
        code,
        message,
        details: {},
      },
      requestId: crypto.randomUUID(),
    },
    status,
  )

async function getW02Service(): Promise<W02Service> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02Service }).W02_AUTH
  if (!service) throw new Error('W02_AUTH_UNAVAILABLE')
  return service
}

async function callW02<T>(path: string, body: unknown): Promise<T> {
  const service = await getW02Service()
  const response = await service.fetch(
    new Request(`https://luckread-w02.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

  let payload: T | W02Error | null = null
  try {
    payload = (await response.json()) as T | W02Error
  } catch {
    payload = null
  }

  if (!response.ok) {
    const code =
      payload &&
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as W02Error).error?.code === 'string'
        ? (payload as W02Error).error!.code!
        : 'SERVICE_UNAVAILABLE'

    throw new Error(code)
  }

  if (!payload || typeof payload !== 'object') throw new Error('SERVICE_UNAVAILABLE')
  return payload as T
}

async function authenticate(request: Request): Promise<AuthenticatedSubject> {
  const payload = await getPayload({ config })

  let authResult: Awaited<ReturnType<typeof payload.auth>>
  try {
    authResult = await payload.auth({
      headers: new Headers({
        Authorization: request.headers.get('Authorization') ?? '',
      }),
      canSetHeaders: false,
    })
  } catch {
    throw new Error('UNAUTHENTICATED')
  }

  const user = authResult.user as { id?: string | number; _sid?: string } | null
  if (!user?.id || typeof user._sid !== 'string' || user._sid.length === 0) {
    throw new Error('UNAUTHENTICATED')
  }

  const tokenVersion = readVerifiedPayloadTokenVersion(request)
  if (tokenVersion === null) throw new Error('UNAUTHENTICATED')

  return {
    userId: String(user.id),
    sessionId: user._sid,
    tokenVersion,
  }
}

function mapW02Error(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'SERVICE_UNAVAILABLE'
  switch (code) {
    case 'UNAUTHENTICATED':
      return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    case 'PERMISSION_DENIED':
      return errorResponse(403, 'PERMISSION_DENIED', 'Permission denied')
    case 'INVALID_CURSOR':
      return errorResponse(400, 'INVALID_CURSOR', 'Invalid cursor')
    case 'INVALID_INPUT':
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid session request')
    default:
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service unavailable')
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) return new Response(null, { status: 404 })

  let subject: AuthenticatedSubject
  try {
    subject = await authenticate(request)
  } catch {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  const url = new URL(request.url)
  const cursor = url.searchParams.get('cursor') ?? undefined
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? undefined : Number(rawLimit)

  try {
    return json(
      await callW02('/internal/auth/session/list', {
        userId: subject.userId,
        currentSessionId: subject.sessionId,
        tokenVersion: subject.tokenVersion,
        cursor,
        limit,
      }),
    )
  } catch (error) {
    return mapW02Error(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 1 || !segments[0]) return new Response(null, { status: 404 })
  const targetSessionId = segments[0]

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  let subject: AuthenticatedSubject
  try {
    subject = await authenticate(request)
  } catch {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  try {
    await callW02('/internal/auth/session/revoke-owned', {
      userId: subject.userId,
      currentSessionId: subject.sessionId,
      tokenVersion: subject.tokenVersion,
      targetSessionId,
    })
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return mapW02Error(error)
  }
}
