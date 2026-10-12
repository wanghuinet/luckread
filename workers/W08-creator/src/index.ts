import { deriveRoleAppointment, mayApplyForCreator, mayReviewCreatorApplication, parseExpectedVersion, validIdempotencyKey } from './policy.js'

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

type ScopeAppointmentRow = {
  appointment_id: string
  scope_id: string
  user_id: string
  scope_role: 'IP_PRINCIPAL' | 'ORG_LEAD' | 'ORG_EDITOR'
  role_id: 'ip_principal' | 'mcn_admin' | 'mcn_editor'
  status: 'PENDING_ROLE_GRANT' | 'ACTIVE'
  grant_ref: string
  appointed_by: string
  idempotency_key: string
  request_fingerprint: string
  created_at: string
  updated_at: string
  scope_type: 'organization' | 'ip'
  name: string
  scope_status: 'ACTIVE' | 'INACTIVE'
  verification_state: 'PENDING' | 'VERIFIED' | 'REJECTED'
}

const json = (body: unknown, status = 200, extraHeaders?: HeadersInit) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(extraHeaders).entries()) },
})

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

const actorLayer = (principal: Principal) => principal.layer ?? null

async function callRoleGrant(
  env: Env,
  originalRequest: Request,
  input: {
    subjectId: string
    roleId: 'creator' | 'ip_principal' | 'mcn_admin' | 'mcn_editor'
    scopeType: 'global' | 'organization' | 'ip'
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
  if (!mayApplyForCreator(actorLayer(principal))) return errorResponse(403, 'VERIFIED_USER_REQUIRED', 'Email verification and L2 access are required')
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
    if (replay.creator_type !== creatorType || replay.statement !== statement) return errorResponse(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different application data')
    return json({ applicationId: replay.application_id, status: replay.status, grantState: replay.grant_state, version: replay.version, replayed: true })
  }

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
    await env.D1_01.prepare(
      "INSERT INTO creator_applications " +
      "(application_id,user_id,creator_type,statement,status,grant_state,version,application_idempotency_key,created_at,updated_at) " +
      "VALUES (?,?,?,?,'PENDING','NOT_REQUESTED',1,?,?,?)",
    ).bind(applicationId, principal.userId, creatorType, statement, key, now, now).run()
  } catch {
    return errorResponse(409, 'APPLICATION_CONFLICT', 'Creator application could not be created; refresh and retry')
  }
  return json({ applicationId, status: 'PENDING', grantState: 'NOT_REQUESTED', version: 1 }, 201, { etag: '"1"' })
}

async function handleApplicationRead(env: Env, request: Request): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
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
  if (!mayReviewCreatorApplication(actorLayer(principal))) return errorResponse(403, 'PERMISSION_DENIED', 'L7 or L8 authorization is required')
  const url = new URL(request.url)
  const limitValue = Number(url.searchParams.get('limit') ?? '25')
  const limit = Number.isSafeInteger(limitValue) ? Math.max(1, Math.min(50, limitValue)) : 25
  const rows = await env.D1_01.prepare(
    "SELECT application_id, user_id, creator_type, statement, status, grant_state, version, created_at " +
    "FROM creator_applications WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?",
  ).bind(limit).all()
  return json({ data: rows.results ?? [], limit })
}

async function handleAdminApplicationDecision(env: Env, request: Request): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  if (!mayReviewCreatorApplication(actorLayer(principal))) return errorResponse(403, 'PERMISSION_DENIED', 'L7 or L8 authorization is required')
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
  if (application.user_id === principal.userId) return errorResponse(403, 'SELF_APPROVAL_DENIED', 'An application cannot be approved by its own applicant')

  if (application.status !== 'PENDING') {
    const sameReplay = application.status === decision &&
      application.decided_by === principal.userId &&
      application.decision_idempotency_key === idempotencyKey
    if (!sameReplay) return errorResponse(409, 'DECISION_CONFLICT', 'This application already has a different final decision')
    return decision === 'APPROVED' ? retryCreatorGrant(env, request, application) : json({
      applicationId: application.application_id,
      status: application.status,
      grantState: application.grant_state,
      version: application.version,
      replayed: true,
    })
  }

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
      await env.D1_01.batch([
        env.D1_01.prepare(
          "UPDATE creator_applications SET status = 'APPROVED', grant_state = 'PENDING', version = version + 1, " +
          'decision_idempotency_key = ?, decided_by = ?, decision_reason = ?, decided_at = ?, updated_at = ? ' +
          "WHERE application_id = ? AND status = 'PENDING' AND version = ?",
        ).bind(idempotencyKey, principal.userId, reason, now, now, application.application_id, expectedVersion),
        env.D1_01.prepare(
          "INSERT INTO creators (creator_id,user_id,application_id,creator_type,status,version,created_at,updated_at) " +
          "VALUES (?,?,?,?,'PENDING_ROLE_GRANT',1,?,?) ON CONFLICT(application_id) DO NOTHING",
        ).bind('creator-' + application.application_id, application.user_id, application.application_id, application.creator_type, now, now),
      ])
    } catch {
      return errorResponse(409, 'CREATOR_IDENTITY_CONFLICT', 'Creator identity could not be established')
    }
    application = (await readApplication(env, application.application_id)) ?? application
    return retryCreatorGrant(env, request, application)
  }

  const now = new Date().toISOString()
  const result = await env.D1_01.prepare(
    "UPDATE creator_applications SET status = 'REJECTED', grant_state = 'NOT_REQUESTED', version = version + 1, " +
    'decision_idempotency_key = ?, decided_by = ?, decision_reason = ?, decided_at = ?, updated_at = ? ' +
    "WHERE application_id = ? AND status = 'PENDING' AND version = ?",
  ).bind(idempotencyKey, principal.userId, reason, now, now, application.application_id, expectedVersion).run()
  if ((result.meta?.changes ?? 0) !== 1) return errorResponse(412, 'PRECONDITION_FAILED', 'Creator application changed; refresh before deciding')
  application = (await readApplication(env, application.application_id)) ?? application
  return json({ applicationId: application.application_id, status: application.status, grantState: application.grant_state, version: application.version })
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

async function readAppointmentByKey(env: Env, actorId: string, key: string): Promise<ScopeAppointmentRow | null> {
  return env.D1_01.prepare(
    'SELECT a.appointment_id, a.scope_id, a.user_id, a.scope_role, a.role_id, a.status, a.grant_ref, ' +
    'a.appointed_by, a.idempotency_key, a.request_fingerprint, a.created_at, a.updated_at, ' +
    's.scope_type, s.name, s.status AS scope_status, s.verification_state ' +
    'FROM creator_scope_appointments a JOIN creator_scopes s ON s.scope_id = a.scope_id ' +
    'WHERE a.appointed_by = ? AND a.idempotency_key = ? LIMIT 1',
  ).bind(actorId, key).first<ScopeAppointmentRow>()
}

async function retryScopeGrant(env: Env, request: Request, appointment: ScopeAppointmentRow): Promise<Response> {
  if (appointment.status === 'ACTIVE') {
    return json({
      appointmentId: appointment.appointment_id,
      scopeId: appointment.scope_id,
      scopeType: appointment.scope_type,
      scopeName: appointment.name,
      userId: appointment.user_id,
      scopeRole: appointment.scope_role,
      roleId: appointment.role_id,
      status: 'ACTIVE',
      replayed: true,
    })
  }
  if (appointment.scope_status !== 'ACTIVE') return errorResponse(409, 'SCOPE_INACTIVE', 'Cannot grant a role in an inactive scope')
  if (appointment.scope_type === 'ip' && appointment.verification_state !== 'VERIFIED') {
    return errorResponse(403, 'IP_SCOPE_NOT_VERIFIED', 'An IP-principal appointment requires a verified IP scope')
  }
  const grant = await callRoleGrant(env, request, {
    subjectId: appointment.user_id,
    roleId: appointment.role_id,
    scopeType: appointment.scope_type,
    scopeId: appointment.scope_id,
    approvalRef: appointment.grant_ref,
  })
  if (!grant.ok) return errorResponse(503, 'ROLE_GRANT_PENDING', 'Appointment was saved but scoped authorization is pending; repeat the same request to retry')
  const now = new Date().toISOString()
  await env.D1_01.prepare(
    "UPDATE creator_scope_appointments SET status = 'ACTIVE', updated_at = ? WHERE appointment_id = ? AND status = 'PENDING_ROLE_GRANT'",
  ).bind(now, appointment.appointment_id).run()
  return json({
    appointmentId: appointment.appointment_id,
    scopeId: appointment.scope_id,
    scopeType: appointment.scope_type,
    scopeName: appointment.name,
    userId: appointment.user_id,
    scopeRole: appointment.scope_role,
    roleId: appointment.role_id,
    status: 'ACTIVE',
    replayed: grant.replayed,
  })
}

async function handleScopeAppointment(env: Env, request: Request): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  if (!mayReviewCreatorApplication(actorLayer(principal))) return errorResponse(403, 'PERMISSION_DENIED', 'L7 or L8 authorization is required to appoint an organization or IP lead')
  const key = request.headers.get('Idempotency-Key')
  if (!validIdempotencyKey(key)) return errorResponse(428, 'PRECONDITION_REQUIRED', 'A valid Idempotency-Key is required')
  const body = await readBody(request)
  if (!body) return errorResponse(400, 'VALIDATION_FAILED', 'A JSON appointment body is required')

  const appointmentRole = deriveRoleAppointment(body.scopeType, body.scopeRole)
  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : ''
  const requestedScopeId = typeof body.scopeId === 'string' ? body.scopeId.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!appointmentRole || targetUserId.length < 1 || targetUserId.length > 128) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid scope appointment; use an allowed scope type, role, and target user')
  }
  if (targetUserId === principal.userId) return errorResponse(400, 'VALIDATION_FAILED', 'Self-appointment is not allowed')
  // Admins may create an organization only while appointing its lead. An IP
  // scope is never created by this public operation; it must already exist
  // and be marked VERIFIED by the rights-verification authority.
  const createsOrganization = !requestedScopeId && appointmentRole.scopeType === 'organization' &&
    appointmentRole.scopeRole === 'ORG_LEAD' && name.length >= 1 && name.length <= 200
  if (!requestedScopeId && !createsOrganization) {
    return errorResponse(400, 'VERIFIED_SCOPE_REQUIRED', 'An existing active scope is required for this appointment')
  }
  if (requestedScopeId && name.length > 0) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Do not send a new scope name when appointing into an existing scope')
  }
  const requestFingerprint = await fingerprint([appointmentRole.scopeType, appointmentRole.scopeRole, targetUserId, requestedScopeId || null, name])
  const existing = await readAppointmentByKey(env, principal.userId, key)
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) return errorResponse(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used with different appointment data')
    return retryScopeGrant(env, request, existing)
  }

  const now = new Date().toISOString()
  const target = await env.D1_01.prepare(
    'SELECT account_state AS accountState, email_verified AS emailVerified FROM "user" WHERE id = ? LIMIT 1',
  ).bind(targetUserId).first<{ accountState: string; emailVerified: number | boolean }>()
  const verifiedRole = await env.D1_01.prepare(
    "SELECT id FROM role_assignments WHERE subject_id = ? AND role_id = 'verified_user' AND scope_type = 'global' " +
    "AND scope_id IS NULL AND status = 'ACTIVE' AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
  ).bind(targetUserId, now, now).first<{ id: string }>()
  if (!target || target.accountState !== 'ACTIVE' || !(target.emailVerified === true || target.emailVerified === 1) || !verifiedRole) {
    return errorResponse(403, 'TARGET_NOT_ELIGIBLE', 'The appointed user must be an ACTIVE email-verified L2 account')
  }

  let scopeId = requestedScopeId
  if (requestedScopeId) {
    const scope = await env.D1_01.prepare(
      'SELECT scope_id, scope_type AS scopeType, status, verification_state AS verificationState FROM creator_scopes WHERE scope_id = ? LIMIT 1',
    ).bind(requestedScopeId).first<{ scope_id: string; scopeType: string; status: string; verificationState: string }>()
    if (!scope || scope.scopeType !== appointmentRole.scopeType || scope.status !== 'ACTIVE') {
      return errorResponse(404, 'SCOPE_NOT_FOUND', 'An active scope of the requested type was not found')
    }
    if (scope.scopeType === 'ip' && scope.verificationState !== 'VERIFIED') {
      return errorResponse(403, 'IP_SCOPE_NOT_VERIFIED', 'An IP-principal appointment requires a verified IP scope')
    }
  } else {
    scopeId = crypto.randomUUID()
  }

  const appointmentId = crypto.randomUUID()
  const grantRef = 'creator-scope-appointment-' + appointmentId
  const statements: D1PreparedStatement[] = []
  if (createsOrganization) {
    statements.push(env.D1_01.prepare(
      "INSERT INTO creator_scopes (scope_id,scope_type,name,status,verification_state,created_by,idempotency_key,request_fingerprint,created_at,updated_at) " +
      "VALUES (?,'organization',?,'ACTIVE','VERIFIED',?,?,?,?,?)",
    ).bind(scopeId, name, principal.userId, key, requestFingerprint, now, now))
  }
  statements.push(env.D1_01.prepare(
    "INSERT INTO creator_scope_appointments (appointment_id,scope_id,user_id,scope_role,role_id,status,grant_ref,appointed_by,idempotency_key,request_fingerprint,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,'PENDING_ROLE_GRANT',?,?,?,?,?,?)",
  ).bind(
    appointmentId, scopeId, targetUserId, appointmentRole.scopeRole, appointmentRole.roleId, grantRef,
    principal.userId, key, requestFingerprint, now, now,
  ))
  try {
    await env.D1_01.batch(statements)
  } catch {
    const raced = await readAppointmentByKey(env, principal.userId, key)
    if (raced && raced.request_fingerprint === requestFingerprint) return retryScopeGrant(env, request, raced)
    return errorResponse(409, 'APPOINTMENT_CONFLICT', 'Scope appointment could not be created; refresh and retry')
  }

  const created = await readAppointmentByKey(env, principal.userId, key)
  if (!created) return errorResponse(503, 'APPOINTMENT_PERSISTENCE_FAILED', 'Scope appointment could not be verified')
  return retryScopeGrant(env, request, created)
}

async function handleMyScopes(env: Env, request: Request): Promise<Response> {
  const principal = await principalFor(env, request)
  if (principal instanceof Response) return principal
  const result = await env.D1_01.prepare(
    "SELECT a.appointment_id AS appointmentId, a.scope_id AS scopeId, s.scope_type AS scopeType, " +
    "s.name AS scopeName, a.scope_role AS scopeRole, a.role_id AS roleId, a.status, a.created_at AS appointedAt " +
    "FROM creator_scope_appointments a JOIN creator_scopes s ON s.scope_id = a.scope_id " +
    "WHERE a.user_id = ? AND a.status = 'ACTIVE' AND s.status = 'ACTIVE' " +
    "AND (s.scope_type <> 'ip' OR s.verification_state = 'VERIFIED') ORDER BY a.created_at DESC LIMIT 100",
  ).bind(principal.userId).all()
  return json({ data: result.results ?? [] })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
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
    if (url.pathname === '/api/v1/admin/creator-scopes' && request.method === 'POST') {
      try { return await handleScopeAppointment(env, request) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator scope appointment service unavailable') }
    }
    if (url.pathname === '/api/v1/creator-scopes/me' && request.method === 'GET') {
      try { return await handleMyScopes(env, request) } catch { return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator scope service unavailable') }
    }
    return errorResponse(404, 'NOT_FOUND', 'Creator endpoint not found')
  },
}
