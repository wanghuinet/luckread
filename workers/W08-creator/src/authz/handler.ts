import {
  AUTHZ_POLICY_VERSION,
  evaluateCaslPermission,
  SUPPORTED_AUTHZ_SUBJECTS,
  type CaslPermissionInput,
  type LayerId,
  type ScopedRoleAssignment,
} from './casl-policy.js'
import { resolvePermissionContext } from './role-layer.js'

type Env = { D1_01: D1Database; W02_AUTH: Fetcher }
type PermissionRequest = {
  action?: unknown
  resourceType?: unknown
  resourceAttributes?: unknown
}
type W02Principal = { active: true; userId: string; accountState?: string }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

async function readJsonBody(request: Request): Promise<PermissionRequest | null> {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > 16_384) return null
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as PermissionRequest
  } catch {
    return null
  }
}

function isSafeAttributes(value: unknown): value is Record<string, unknown> {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 32) return false
  return entries.every(([key, item]) =>
    key.length > 0 && key.length <= 64 &&
    !key.startsWith('$') && key !== '__proto__' && key !== 'prototype' && key !== 'constructor' &&
    (item === null || typeof item === 'string' || typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))),
  )
}

function deny(reasonCode: string, status = 200) {
  return json({ decision: 'DENY', reasonCode, policyVersion: AUTHZ_POLICY_VERSION }, status)
}

async function resolveSubjectFromW02Session(
  request: Request,
  env: Env,
): Promise<{ userId: string } | null | Response> {
  // Browser cookies and native Bearer tokens are canonical session carriers.
  // W08 forwards either to W02 and never interprets raw credentials itself.
  if (!request.headers.has('cookie') && !request.headers.has('authorization')) return null
  try {
    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')
    const response = await env.W02_AUTH.fetch(new Request(
      'https://luckread-w02.internal/internal/auth/principal',
      { method: 'POST', headers },
    ))
    const value: unknown = await response.json().catch(() => null)
    if (
      response.ok && value && typeof value === 'object' &&
      (value as W02Principal).active === true &&
      typeof (value as W02Principal).userId === 'string' &&
      (value as W02Principal).userId.length > 0
    ) {
      return { userId: (value as W02Principal).userId }
    }
    if (response.status === 401 || (value as { active?: unknown } | null)?.active === false) return null
    return deny('IDENTITY_SERVICE_UNAVAILABLE', 503)
  } catch {
    return deny('IDENTITY_SERVICE_UNAVAILABLE', 503)
  }
}

/**
 * Internal-only permission endpoint. Actor identity comes from a W02 session,
 * and current account/role/scope facts come from D1-01. Callers cannot submit
 * subjectId, layer, account state, or scoped-role facts. Resource attributes
 * must be loaded server-side by the owning domain before this endpoint is used.
 */
export async function handlePermissionCheck(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'POST' || url.pathname !== '/internal/authz/check-permission') {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } })
  }

  const body = await readJsonBody(request)
  if (!body) return deny('INVALID_AUTHORIZATION_REQUEST', 400)

  const allowedKeys = new Set(['action', 'resourceType', 'resourceAttributes'])
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return deny('CALLER_SUPPLIED_AUTHORIZATION_CONTEXT', 400)
  }
  if (
    typeof body.action !== 'string' || body.action.trim().length === 0 || body.action.length > 128 ||
    typeof body.resourceType !== 'string' ||
    !(SUPPORTED_AUTHZ_SUBJECTS as readonly string[]).includes(body.resourceType) ||
    !isSafeAttributes(body.resourceAttributes)
  ) {
    return deny('INVALID_AUTHORIZATION_REQUEST', 400)
  }

  const action = body.action
  const resourceType = body.resourceType
  const resourceAttributes = (body.resourceAttributes ?? {}) as Record<string, unknown>
  const actor = await resolveSubjectFromW02Session(request, env)
  if (actor instanceof Response) return actor
  const subjectId = actor?.userId ?? null

  try {
    let context: { layer: LayerId; scopedRoleAssignments: ScopedRoleAssignment[] }
    let accountState: string | null

    if (subjectId === null) {
      context = { layer: 'L0', scopedRoleAssignments: [] }
      accountState = null
    } else {
      const account = await env.D1_01
        .prepare('SELECT account_state AS accountState FROM "user" WHERE id = ? LIMIT 1')
        .bind(subjectId)
        .first<{ accountState: string }>()
      if (!account) return deny('SUBJECT_NOT_FOUND')

      accountState = account.accountState
      if (accountState === 'RESTRICTED' || accountState === 'FROZEN') {
        context = { layer: 'L1', scopedRoleAssignments: [] }
      } else if (accountState === 'ACTIVE' || accountState === 'PENDING_VERIFICATION') {
        const resolved = await resolvePermissionContext(env.D1_01, subjectId)
        if (!resolved) return deny('LAYER_RESOLUTION_DENIED')
        context = resolved
      } else {
        return deny('ACCOUNT_STATE_DENY')
      }
    }

    const input: CaslPermissionInput = {
      ...context,
      subjectId,
      accountState,
      action,
      resourceType,
      resourceAttributes,
    }
    return json(evaluateCaslPermission(input))
  } catch {
    return deny('AUTHORIZATION_INPUT_UNAVAILABLE', 503)
  }
}
