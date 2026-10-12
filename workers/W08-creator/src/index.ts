import { admitCreatorDecision, creatorApplicationReplayMatches, parseExpectedVersion, validIdempotencyKey } from './policy.js'
import { evaluateCreatorApplicationPermission } from './authz/creator-application-permission.js'
import { handlePermissionCheck } from './authz/handler.js'

interface Env {
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

type ApplicationRow = {
  application_id: string
  user_id: string
  creator_type: string
  statement: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  grant_state: 'NOT_REQUESTED' | 'PENDING' | 'GRANTED'
  version: number
  application_idempotency_key: string
  decision_idempotency_key: string | null
  decided_by: string | null
  decision_reason: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
}

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
    headers.delete('authorization')
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

function auditStatement(
  env: Env,
  input: {
    eventKey: string
    actorId: string
    subjectId: string
    eventType: 'CREATOR_APPLICATION_SUBMITTED' | 'CREATOR_APPLICATION_APPROVED' | 'CREATOR_APPLICATION_REJECTED' | 'CREATOR_ROLE_GRANTED'
    resourceType: 'creator_application' | 'creator' | 'role_assignment'
    resourceId: string
    fromState: string | null
    toState: string | null
    idempotencyKey?: string | null
    request: Request
    details?: Record<string, unknown>
    occurredAt?: string
  },
): D1PreparedStatement {
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const correlationId = input.request.headers.get('X-LuckRead-Correlation-Id')?.trim().slice(0, 128) ||
    input.request.headers.get('cf-ray')?.trim().slice(0, 128) || null
  return env.D1_01.prepare(
    'INSERT OR IGNORE INTO creator_authorization_audit ' +
    '(audit_id,event_key,actor_id,subject_id,event_type,resource_type,resource_id,from_state,to_state,idempotency_key,correlation_id,occurred_at,details_json) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(
    crypto.randomUUID(),
    input.eventKey,
    input.actorId,
    input.subjectId,
    input.eventType,
    input.resourceType,
    input.resourceId,
    input.fromState,
    input.toState,
    input.idempotencyKey ?? null,
    correlationId,
    occurredAt,
    JSON.stringify(input.details ?? {}),
  )
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
    headers.delete('authorization')
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

async function readApplication(env: Env, applicationId: string): Promise<ApplicationRow | null> {
  return env.D1_01.prepare(
    'SELECT application_id, user_id, creator_type, statement, status, grant_state, version, ' +
    'application_idempotency_key, decision_idempotency_key, decided_by, decision_reason, created_at, updated_at, decided_at ' +
    'FROM creator_applications WHERE application_id = ? LIMIT 1',
  ).bind(applicationId).first<ApplicationRow>()
}

async function retryCreatorGrant(
  env: Env,
  request: Request,
  application: ApplicationRow,
): Promise<Response> {
  if (application.status !== 'APPROVED') {
    return json({ applicationId: application.application_id, status: application.status, grantState: application.grant_state, version: application.version })
  }
  if (application.grant_state === 'GRANTED') {
    return json({ applicationId: application.application_id, status: application.status, grantState: application.grant_state, version: application.version, replayed: true })
  }

  const creator = await env.D1_01.prepare(
    'SELECT creator_id AS creatorId, application_id AS applicationId FROM creators WHERE user_id = ? LIMIT 1',
  ).bind(application.user_id).first<{ creatorId: string; applicationId: string }>()

  if (!creator || creator.applicationId !== application.application_id) {
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
  await env.D1_01.batch([
    env.D1_01.prepare(
      "UPDATE creator_applications SET grant_state = 'GRANTED', version = version + 1, updated_at = ? " +
      "WHERE application_id = ? AND status = 'APPROVED' AND grant_state = 'PENDING'",
    ).bind(now, application.application_id),
    env.D1_01.prepare(
      "UPDATE creators SET status = 'ACTIVE', version = version + 1, updated_at = ? " +
      "WHERE application_id = ? AND status = 'PENDING_ROLE_GRANT'",
    ).bind(now, application.application_id),
    auditStatement(env, {
      eventKey: 'creator-role-granted:' + application.application_id,
      actorId: application.decided_by ?? 'system',
      subjectId: application.user_id,
      eventType: 'CREATOR_ROLE_GRANTED',
      resourceType: 'creator',
      resourceId: creator.creatorId,
      fromState: 'PENDING_ROLE_GRANT',
      toState: 'ACTIVE',
      idempotencyKey: application.decision_idempotency_key,
      request,
      details: { roleId: 'creator', approvalRef: 'creator-application-' + application.application_id },
      occurredAt: now,
    }),
  ])
  const latest = await readApplication(env, application.application_id)
  return json({
    applicationId: application.application_id,
    status: latest?.status ?? 'APPROVED',
    grantState: latest?.grant_state ?? 'GRANTED',
    version: latest?.version ?? application.version + 1,
    replayed: grant.replayed,
  })
}

async function handleApplicationCreate(env: Env, request: Request): Promise<Response> {
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
  // Any client-supplied role/layer/approval/scope fields are ignored. Only the
  // allow-listed application fields above are persisted.
  const now = new Date().toISOString()
  const replay = await env.D1_01.prepare(
    'SELECT application_id, user_id, creator_type, statement, status, grant_state, version, created_at ' +
    'FROM creator_applications WHERE user_id = ? AND application_idempotency_key = ? LIMIT 1',
  ).bind(principal.userId, key).first<{
    application_id: string; user_id: string; creator_type: string; statement: string; status: string; grant_state: string; version: number; created_at: string
  }>()
  if (replay) {
    if (!creatorApplicationReplayMatches(replay, { creatorType, statement })) return errorResponse(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different application data')
    return json({ applicationId: replay.application_id, status: replay.status, grantState: replay.grant_state, version: replay.version, replayed: true })
  }
  if (evaluateCreatorApplicationPermission(principal, 'creator.application.apply', { ownerId: principal.userId }).decision !== 'ALLOW') return errorResponse(403, 'VERIFIED_USER_REQUIRED', 'Email verification and L2 access are required')

  const existingCreator = await env.D1_01.prepare(
    'SELECT creator_id FROM creators WHERE user_id = ? LIMIT 1',
  ).bind(principal.userId).first<{ creator_id: string }>()
  if (existingCreator) return errorResponse(409, 'CREATOR_ALREADY_EXISTS', 'This account already has a creator identity')

  const existingPending = await env.D1_01.prepare(
    "SELECT application_id FROM creator_applications WHERE user_id = ? AND status = 'PENDING' LIMIT 1",
  ).bind(principal.userId).first<{ application_id: string }>()
  if (existingPending) return errorResponse(409, 'APPLICATION_ALREADY_PENDING', 'A creator application is already pending')

  const applicationId = crypto.randomUUID()
  try {
    await env.D1_01.batch([
      env.D1_01.prepare(
        "INSERT INTO creator_applications " +
        "(application_id,user_id,creator_type,statement,status,grant_state,version,application_idempotency_key,created_at,updated_at) " +
        "VALUES (?,?,?,?,'PENDING','NOT_REQUESTED',1,?,?,?)",
      ).bind(applicationId, principal.userId, creatorType, statement, key, now, now),
      auditStatement(env, {
        eventKey: 'creator-application-submitted:' + applicationId,
        actorId: principal.userId,
        subjectId: principal.userId,
        eventType: 'CREATOR_APPLICATION_SUBMITTED',
        resourceType: 'creator_application',
        resourceId: applicationId,
        fromState: null,
        toState: 'PENDING',
        idempotencyKey: key,
        request,
        details: { creatorType },
        occurredAt: now,
      }),
    ])
  } catch {
    return errorResponse(409, 'APPLICATION_CONFLICT', 'Creator application could not be created; refresh and retry')
  }
  return json({ applicationId, status: 'PENDING', grantState: 'NOT_REQUESTED', version: 1 }, 201, { etag: '"1"' })
}

async function handleApplicationRead(env: Env, request: Request): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  if (evaluateCreatorApplicationPermission(principal, 'creator.application.read.own', { ownerId: principal.userId }).decision !== 'ALLOW') {
    return errorResponse(403, 'PERMISSION_DENIED', 'You may only read your own creator application')
  }
  const row = await env.D1_01.prepare(
    'SELECT application_id, creator_type, statement, status, grant_state, version, created_at, updated_at, decided_at, decision_reason ' +
    'FROM creator_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(principal.userId).first<{
    application_id: string; creator_type: string; statement: string; status: string; grant_state: string; version: number
    created_at: string; updated_at: string; decided_at: string | null; decision_reason: string | null
  }>()
  return json({ application: row ?? null }, 200, row ? { etag: '"' + row.version + '"' } : undefined)
}

async function handleAdminApplicationList(env: Env, request: Request): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  if (evaluateCreatorApplicationPermission(principal, 'creator.application.review', {}).decision !== 'ALLOW') return errorResponse(403, 'PERMISSION_DENIED', 'L7 or L8 authorization is required')
  const url = new URL(request.url)
  const limitValue = Number(url.searchParams.get('limit') ?? '25')
  const limit = Number.isSafeInteger(limitValue) ? Math.max(1, Math.min(50, limitValue)) : 25
  const rows = await env.D1_01.prepare(
    "SELECT application_id, user_id, creator_type, statement, status, grant_state, version, created_at " +
    "FROM creator_applications WHERE status = 'PENDING' OR (status = 'APPROVED' AND grant_state = 'PENDING' AND decided_by = ?) ORDER BY created_at ASC LIMIT ?",
  ).bind(principal.userId, limit).all()
  return json({ data: rows.results ?? [], limit })
}

async function handleAdminApplicationDecision(env: Env, request: Request): Promise<Response> {
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

  let application = await readApplication(env, body.applicationId)
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
  if (admission === 'REPLAY') return decision === 'APPROVED' ? retryCreatorGrant(env, request, application) : json({
    applicationId: application.application_id,
    status: application.status,
    grantState: application.grant_state,
    version: application.version,
    replayed: true,
  })

  const expectedVersion = parseExpectedVersion(request.headers.get('If-Match'))
  if (expectedVersion === null) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match with the current application version is required')
  if (expectedVersion !== application.version) return errorResponse(412, 'PRECONDITION_FAILED', 'Creator application changed; refresh before deciding')

  if (decision === 'APPROVED') {
    const existingCreator = await env.D1_01.prepare(
      'SELECT application_id FROM creators WHERE user_id = ? LIMIT 1',
    ).bind(application.user_id).first<{ application_id: string }>()
    if (existingCreator && existingCreator.application_id !== application.application_id) {
      return errorResponse(409, 'CREATOR_IDENTITY_CONFLICT', 'User already has a creator identity')
    }
    const now = new Date().toISOString()
    try {
      const results = await env.D1_01.batch([
        env.D1_01.prepare(
          "UPDATE creator_applications SET status = 'APPROVED', grant_state = 'PENDING', version = version + 1, " +
          'decision_idempotency_key = ?, decided_by = ?, decision_reason = ?, decided_at = ?, updated_at = ? ' +
          "WHERE application_id = ? AND status = 'PENDING' AND version = ?",
        ).bind(idempotencyKey, principal.userId, reason, now, now, application.application_id, expectedVersion),
        env.D1_01.prepare(
          "INSERT INTO creators (creator_id,user_id,application_id,creator_type,status,version,created_at,updated_at) " +
          "SELECT ?, user_id, application_id, creator_type, 'PENDING_ROLE_GRANT', 1, ?, ? " +
          "FROM creator_applications WHERE application_id = ? AND status = 'APPROVED' " +
          "AND decision_idempotency_key = ? AND decided_by = ? " +
          "ON CONFLICT(application_id) DO NOTHING",
        ).bind('creator-' + application.application_id, now, now, application.application_id, idempotencyKey, principal.userId),
        env.D1_01.prepare(
          "INSERT OR IGNORE INTO creator_authorization_audit " +
          "(audit_id,event_key,actor_id,subject_id,event_type,resource_type,resource_id,from_state,to_state,idempotency_key,correlation_id,occurred_at,details_json) " +
          "SELECT ?, ?, ?, user_id, 'CREATOR_APPLICATION_APPROVED', 'creator_application', application_id, 'PENDING', 'APPROVED', ?, ?, ?, ? " +
          "FROM creator_applications WHERE application_id = ? AND status = 'APPROVED' " +
          "AND decision_idempotency_key = ? AND decided_by = ?",
        ).bind(
          crypto.randomUUID(), 'creator-application-decision:' + application.application_id + ':' + idempotencyKey,
          principal.userId, idempotencyKey,
          request.headers.get('X-LuckRead-Correlation-Id')?.trim().slice(0, 128) || request.headers.get('cf-ray')?.trim().slice(0, 128) || null,
          now, JSON.stringify({ reason }), application.application_id, idempotencyKey, principal.userId,
        ),
      ])
      if ((results[0]?.meta?.changes ?? 0) !== 1) {
        const current = await readApplication(env, application.application_id)
        if (!current || current.status !== 'APPROVED' || current.decided_by !== principal.userId || current.decision_idempotency_key !== idempotencyKey) {
          return errorResponse(412, 'PRECONDITION_FAILED', 'Creator application changed; refresh before deciding')
        }
      }
    } catch {
      return errorResponse(409, 'CREATOR_IDENTITY_CONFLICT', 'Creator identity could not be established')
    }
    application = (await readApplication(env, application.application_id)) ?? application
    return retryCreatorGrant(env, request, application)
  }

  const now = new Date().toISOString()
  const results = await env.D1_01.batch([
    env.D1_01.prepare(
      "UPDATE creator_applications SET status = 'REJECTED', grant_state = 'NOT_REQUESTED', version = version + 1, " +
      'decision_idempotency_key = ?, decided_by = ?, decision_reason = ?, decided_at = ?, updated_at = ? ' +
      "WHERE application_id = ? AND status = 'PENDING' AND version = ?",
    ).bind(idempotencyKey, principal.userId, reason, now, now, application.application_id, expectedVersion),
    env.D1_01.prepare(
      "INSERT OR IGNORE INTO creator_authorization_audit " +
      "(audit_id,event_key,actor_id,subject_id,event_type,resource_type,resource_id,from_state,to_state,idempotency_key,correlation_id,occurred_at,details_json) " +
      "SELECT ?, ?, ?, user_id, 'CREATOR_APPLICATION_REJECTED', 'creator_application', application_id, 'PENDING', 'REJECTED', ?, ?, ?, ? " +
      "FROM creator_applications WHERE application_id = ? AND status = 'REJECTED' " +
      "AND decision_idempotency_key = ? AND decided_by = ?",
    ).bind(
      crypto.randomUUID(), 'creator-application-decision:' + application.application_id + ':' + idempotencyKey,
      principal.userId, idempotencyKey,
      request.headers.get('X-LuckRead-Correlation-Id')?.trim().slice(0, 128) || request.headers.get('cf-ray')?.trim().slice(0, 128) || null,
      now, JSON.stringify({ reason }), application.application_id, idempotencyKey, principal.userId,
    ),
  ])
  if ((results[0]?.meta?.changes ?? 0) !== 1) return errorResponse(412, 'PRECONDITION_FAILED', 'Creator application changed; refresh before deciding')
  application = (await readApplication(env, application.application_id)) ?? application
  return json({ applicationId: application.application_id, status: application.status, grantState: application.grant_state, version: application.version })
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
    if (url.pathname === '/api/v1/creator-applications' && request.method === 'POST') {
      try { return await handleApplicationCreate(env, request) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    if (url.pathname === '/api/v1/creator-applications/me' && request.method === 'GET') {
      try { return await handleApplicationRead(env, request) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    if (url.pathname === '/api/v1/admin/creator-applications' && request.method === 'GET') {
      try { return await handleAdminApplicationList(env, request) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    if (url.pathname === '/api/v1/admin/creator-applications/decision' && request.method === 'POST') {
      try { return await handleAdminApplicationDecision(env, request) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator application service unavailable') }
    }
    return errorResponse(404, 'NOT_FOUND', 'Creator endpoint not found')
  },
}
