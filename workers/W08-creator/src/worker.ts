import { admitCreatorDecision, creatorApplicationReplayMatches, parseExpectedVersion, validIdempotencyKey } from './policy.js'
import { evaluateCreatorApplicationPermission } from './authz/creator-application-permission.js'
import { handlePermissionCheck } from './authz/handler.js'
import { handleScheduledPublishPermission } from './authz/scheduled-publish.js'
import { evaluateCaslPermission, type LayerId } from './authz/casl-policy.js'
import { getW08CreatorStore, type W08RuntimeEnv } from './neon/runtime.js'
import type { CreatorApplicationRow, W08CreatorStore } from './creator-store.js'

interface Env extends W08RuntimeEnv {
  D1_01: D1Database
  W02_AUTH: Fetcher
}

type Principal = {
  active: boolean
  userId: string
  email: string
  accountState?: string
  layer?: string
}

type ApplicationRow = CreatorApplicationRow

const json = (body: unknown, status = 200, extraHeaders?: HeadersInit) => {
  const headers = new Headers({ 'cache-control': 'no-store' })
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value))
  return Response.json({ data: body, requestId: crypto.randomUUID() }, { status, headers })
}

const errorResponse = (status: number, code: string, message: string) =>
  json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, status)

const readBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  try {
    const value: unknown = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function principalFor(env: Env, request: Request): Promise<Principal | Response> {
  try {
    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')
    const response = await env.W02_AUTH.fetch(new Request('https://luckread-w02.internal/internal/auth/principal', {
      method: 'POST',
      headers,
    }))
    const value: unknown = await response.json().catch(() => null)
    if (
      response.ok && value && typeof value === 'object' &&
      (value as Principal).active === true &&
      typeof (value as Principal).userId === 'string' &&
      typeof (value as Principal).layer === 'string'
    ) {
      const principal = value as Principal
      if (principal.accountState !== 'ACTIVE') return errorResponse(403, 'ACCOUNT_NOT_ACTIVE', 'An active account is required')
      return principal
    }
    if (response.status === 401 || (value as { active?: unknown } | null)?.active === false) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    }
    return errorResponse(503, 'IDENTITY_SERVICE_UNAVAILABLE', 'Identity service unavailable')
  } catch {
    return errorResponse(503, 'IDENTITY_SERVICE_UNAVAILABLE', 'Identity service unavailable')
  }
}



async function callRoleGrant(
  env: Env,
  originalRequest: Request,
  input: {
    subjectId: string
    roleId: 'creator'
    scopeType: 'global'
    scopeId: string | null
    approvalRef: string
  },
): Promise<{ ok: true; replayed: boolean } | { ok: false; status: number; code: string }> {
  try {
    const headers = new Headers(originalRequest.headers)
    headers.delete('host')
    headers.delete('content-length')
    headers.set('X-LuckRead-Caller', 'W08')
    headers.set('X-LuckRead-Transport-Version', '1.0')
    headers.set('content-type', 'application/json; charset=utf-8')
    const response = await env.W02_AUTH.fetch(new Request('https://luckread-w02.internal/internal/authz/role-assignment', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }))
    const value: unknown = await response.json().catch(() => null)
    if (response.ok && value && typeof value === 'object' && typeof (value as { assignmentId?: unknown }).assignmentId === 'string') {
      return { ok: true, replayed: (value as { replayed?: unknown }).replayed === true }
    }
    const payload = value as { error?: { code?: unknown } } | null
    return {
      ok: false,
      status: response.status >= 400 && response.status < 600 ? response.status : 503,
      code: typeof payload?.error?.code === 'string' ? payload.error.code : 'ROLE_GRANT_FAILED',
    }
  } catch {
    return { ok: false, status: 503, code: 'ROLE_GRANT_UNAVAILABLE' }
  }
}



async function retryCreatorGrant(
  env: Env,
  request: Request,
  store: W08CreatorStore,
  application: ApplicationRow,
): Promise<Response> {
  if (application.status !== 'APPROVED') {
    return json({ applicationId: application.application_id, status: application.status, grantState: application.grant_state, version: application.version })
  }
  if (application.grant_state === 'GRANTED') {
    return json({ applicationId: application.application_id, status: application.status, grantState: application.grant_state, version: application.version, replayed: true })
  }

  const creator = await store.findCreatorByUser(application.user_id)
  if (!creator || creator.application_id !== application.application_id) {
    return errorResponse(409, 'CREATOR_IDENTITY_CONFLICT', 'Creator identity is already linked to another application')
  }

  const grant = await callRoleGrant(env, request, {
    subjectId: application.user_id,
    roleId: 'creator',
    scopeType: 'global',
    scopeId: null,
    approvalRef: 'creator-application-' + application.application_id,
  })
  if (!grant.ok) {
    return errorResponse(503, 'ROLE_GRANT_PENDING', 'Approval was saved but creator authorization is pending; repeat the same decision to retry')
  }

  const now = new Date().toISOString()
  await store.completeCreatorGrant({
    applicationId: application.application_id,
    applicantId: application.user_id,
    creatorId: creator.creator_id,
    actorId: application.decided_by ?? 'system',
    idempotencyKey: application.decision_idempotency_key,
    correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim().slice(0, 128) ||
      request.headers.get('cf-ray')?.trim().slice(0, 128) || null,
    now,
  })
  const latest = await store.readApplication(application.application_id)
  return json({
    applicationId: application.application_id,
    status: latest?.status ?? 'APPROVED',
    grantState: latest?.grant_state ?? 'GRANTED',
    version: latest?.version ?? application.version + 1,
    replayed: grant.replayed,
  })
}

async function handleApplicationCreate(env: Env, request: Request, store: W08CreatorStore): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  const key = request.headers.get('Idempotency-Key')
  if (!validIdempotencyKey(key)) return errorResponse(428, 'PRECONDITION_REQUIRED', 'A valid Idempotency-Key is required')

  const body = await readBody(request)
  if (!body) return errorResponse(400, 'VALIDATION_FAILED', 'A JSON application body is required')
  const creatorType = typeof body.creatorType === 'string' ? body.creatorType.toUpperCase() : ''
  const statement = typeof body.statement === 'string' ? body.statement.trim() : ''
  if (!['PERSONAL', 'WRITER', 'VIDEO_CREATOR', 'DEVELOPER', 'ARTIST', 'OTHER'].includes(creatorType)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Unsupported creator type')
  }
  if (statement.length > 2000) return errorResponse(400, 'VALIDATION_FAILED', 'Application statement is too long')

  const replay = await store.findApplicationByIdempotency(principal.userId, key)
  if (replay) {
    if (!creatorApplicationReplayMatches(replay, { creatorType, statement })) return errorResponse(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different application data')
    return json({ applicationId: replay.application_id, status: replay.status, grantState: replay.grant_state, version: replay.version, replayed: true })
  }
  if (evaluateCreatorApplicationPermission(principal, 'creator.application.apply', { ownerId: principal.userId }).decision !== 'ALLOW') return errorResponse(403, 'VERIFIED_USER_REQUIRED', 'Email verification and L2 access are required')

  const existingCreator = await store.findCreatorByUser(principal.userId)
  if (existingCreator) return errorResponse(409, 'CREATOR_ALREADY_EXISTS', 'This account already has a creator identity')

  const existingPending = await store.findPendingApplicationByUser(principal.userId)
  if (existingPending) return errorResponse(409, 'APPLICATION_ALREADY_PENDING', 'A creator application is already pending')

  const applicationId = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    await store.createApplication({
      applicationId,
      userId: principal.userId,
      creatorType,
      statement,
      idempotencyKey: key,
      correlationId: request.headers.get('X-LuckRead-Correlation-Id')?.trim().slice(0, 128) ||
        request.headers.get('cf-ray')?.trim().slice(0, 128) || null,
      now,
    })
  } catch {
    return errorResponse(409, 'APPLICATION_CONFLICT', 'Creator application could not be created; refresh and retry')
  }
  return json({ applicationId, status: 'PENDING', grantState: 'NOT_REQUESTED', version: 1 }, 201, { etag: '"1"' })
}

async function handleApplicationRead(env: Env, request: Request, store: W08CreatorStore): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  if (evaluateCreatorApplicationPermission(principal, 'creator.application.read.own', { ownerId: principal.userId }).decision !== 'ALLOW') {
    return errorResponse(403, 'PERMISSION_DENIED', 'You may only read your own creator application')
  }
  const row = await store.findOwnApplication(principal.userId)
  return json({ application: row ?? null }, 200, row ? { etag: '"' + row.version + '"' } : undefined)
}

async function handleAdminApplicationList(env: Env, request: Request, store: W08CreatorStore): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  if (evaluateCreatorApplicationPermission(principal, 'creator.application.review', {}).decision !== 'ALLOW') return errorResponse(403, 'PERMISSION_DENIED', 'L7 or L8 authorization is required')
  const url = new URL(request.url)
  const limitValue = Number(url.searchParams.get('limit') ?? '25')
  const limit = Number.isSafeInteger(limitValue) ? Math.max(1, Math.min(50, limitValue)) : 25
  const rows = await store.listReviewableApplications(principal.userId, limit)
  return json({ data: rows, limit })
}

async function handleAdminApplicationDecision(env: Env, request: Request, store: W08CreatorStore): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  if (evaluateCreatorApplicationPermission(principal, 'creator.application.review', {}).decision !== 'ALLOW') return errorResponse(403, 'PERMISSION_DENIED', 'L7 or L8 authorization is required')
  const idempotencyKey = request.headers.get('Idempotency-Key')
  if (!validIdempotencyKey(idempotencyKey)) return errorResponse(428, 'PRECONDITION_REQUIRED', 'A valid Idempotency-Key is required')
  const body = await readBody(request)
  if (!body || typeof body.applicationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.applicationId)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid applicationId')
  }
  const decision = typeof body.decision === 'string' ? body.decision.toUpperCase() : ''
  if (decision !== 'APPROVED' && decision !== 'REJECTED') return errorResponse(400, 'VALIDATION_FAILED', 'Decision must be APPROVED or REJECTED')
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length > 500) return errorResponse(400, 'VALIDATION_FAILED', 'Decision reason is too long')

  let application = await store.readApplication(body.applicationId)
  if (!application) return errorResponse(404, 'NOT_FOUND', 'Creator application not found')
  const admission = admitCreatorDecision({
    applicationStatus: application.status,
    requestedDecision: decision,
    applicantId: application.user_id,
    actorId: principal.userId,
    storedDecision: application.status,
    storedActorId: application.decided_by,
    storedIdempotencyKey: application.decision_idempotency_key,
    requestIdempotencyKey: idempotencyKey,
  })
  if (admission === 'SELF_APPROVAL_DENIED') return errorResponse(403, 'SELF_APPROVAL_DENIED', 'An application cannot be approved by its own applicant')
  if (admission === 'DECISION_CONFLICT') return errorResponse(409, 'DECISION_CONFLICT', 'This application already has a different final decision')
  if (admission === 'REPLAY') return decision === 'APPROVED' ? retryCreatorGrant(env, request, store, application) : json({
    applicationId: application.application_id,
    status: application.status,
    grantState: application.grant_state,
    version: application.version,
    replayed: true,
  })

  const expectedVersion = parseExpectedVersion(request.headers.get('If-Match'))
  if (expectedVersion === null) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match with the current application version is required')
  if (expectedVersion !== application.version) return errorResponse(412, 'PRECONDITION_FAILED', 'Creator application changed; refresh before deciding')

  const correlationId = request.headers.get('X-LuckRead-Correlation-Id')?.trim().slice(0, 128) ||
    request.headers.get('cf-ray')?.trim().slice(0, 128) || null
  if (decision === 'APPROVED') {
    const existingCreator = await store.findCreatorByUser(application.user_id)
    if (existingCreator && existingCreator.application_id !== application.application_id) {
      return errorResponse(409, 'CREATOR_IDENTITY_CONFLICT', 'User already has a creator identity')
    }
    const now = new Date().toISOString()
    try {
      const changed = await store.approveApplication({
        applicationId: application.application_id,
        applicantId: application.user_id,
        creatorType: application.creator_type,
        actorId: principal.userId,
        idempotencyKey,
        reason,
        expectedVersion,
        correlationId,
        now,
      })
      if (!changed) {
        const current = await store.readApplication(application.application_id)
        if (!current || current.status !== 'APPROVED' || current.decided_by !== principal.userId || current.decision_idempotency_key !== idempotencyKey) {
          return errorResponse(412, 'PRECONDITION_FAILED', 'Creator application changed; refresh before deciding')
        }
      }
    } catch {
      return errorResponse(409, 'CREATOR_IDENTITY_CONFLICT', 'Creator identity could not be established')
    }
    application = (await store.readApplication(application.application_id)) ?? application
    return retryCreatorGrant(env, request, store, application)
  }

  const now = new Date().toISOString()
  const changed = await store.rejectApplication({
    applicationId: application.application_id,
    applicantId: application.user_id,
    creatorType: application.creator_type,
    actorId: principal.userId,
    idempotencyKey,
    reason,
    expectedVersion,
    correlationId,
    now,
  })
  if (!changed) return errorResponse(412, 'PRECONDITION_FAILED', 'Creator application changed; refresh before deciding')
  application = (await store.readApplication(application.application_id)) ?? application
  return json({ applicationId: application.application_id, status: application.status, grantState: application.grant_state, version: application.version })
}

async function handleActiveCreatorSelf(env: Env, request: Request, store: W08CreatorStore): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal

  const permission = evaluateCaslPermission({
    layer: (principal.layer ?? '') as LayerId,
    subjectId: principal.userId,
    accountState: principal.accountState ?? null,
    action: 'creator.read.self',
    resourceType: 'Creator',
    resourceAttributes: { ownerId: principal.userId },
  })
  if (permission.decision !== 'ALLOW') {
    return errorResponse(403, 'CREATOR_PERMISSION_REQUIRED', 'An active creator identity is required')
  }

  const creator = await store.findActiveCreator(principal.userId)
  if (!creator) return errorResponse(403, 'CREATOR_NOT_ACTIVE', 'An active creator identity is required')
  return json({ creatorId: creator.creator_id, status: 'ACTIVE' })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/internal/authz/check-permission') {
      try {
        return await handlePermissionCheck(request, env)
      } catch {
        return Response.json(
          { decision: 'DENY', reasonCode: 'AUTHORIZATION_INPUT_UNAVAILABLE', policyVersion: 'casl-l0-l8-v1' },
          { status: 503, headers: { 'cache-control': 'no-store' } },
        )
      }
    }
    if (request.method === 'POST' && url.pathname === '/internal/authz/check-scheduled-publish') {
      try {
        return await handleScheduledPublishPermission(request, env)
      } catch {
        return Response.json(
          { decision: 'DENY', reasonCode: 'AUTHORIZATION_INPUT_UNAVAILABLE', policyVersion: 'casl-l0-l8-v1' },
          { status: 503, headers: { 'cache-control': 'no-store' } },
        )
      }
    }
    if (url.pathname === '/internal/creator/self' && request.method === 'GET') {
      try { return await handleActiveCreatorSelf(env, request, getW08CreatorStore(env)) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator service unavailable') }
    }
    if (url.pathname === '/api/v1/creator-applications' && request.method === 'POST') {
      try { return await handleApplicationCreate(env, request, getW08CreatorStore(env)) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    if (url.pathname === '/api/v1/creator-applications/me' && request.method === 'GET') {
      try { return await handleApplicationRead(env, request, getW08CreatorStore(env)) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    if (url.pathname === '/api/v1/admin/creator-applications' && request.method === 'GET') {
      try { return await handleAdminApplicationList(env, request, getW08CreatorStore(env)) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    if (url.pathname === '/api/v1/admin/creator-applications/decision' && request.method === 'POST') {
      try { return await handleAdminApplicationDecision(env, request, getW08CreatorStore(env)) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    return errorResponse(404, 'NOT_FOUND', 'Creator endpoint not found')
  },
}
