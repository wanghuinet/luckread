import {
  activeMfaPrincipal,
  callFactor,
  enforceMfaAccountAndEndpointLimits,
  enforceMfaEdgeLimit,
  isRecord,
  mfaError,
  onlyKeys,
  requireVerifiedMfa,
  validPassword,
} from '../shared.js'

export async function POST(request: Request): Promise<Response> {
  const edgeError = await enforceMfaEdgeLimit(request)
  if (edgeError) return edgeError

  let body: unknown
  try { body = await request.json() } catch {
    return mfaError(422, 'VALIDATION_FAILED', 'Invalid MFA disable request')
  }
  if (!isRecord(body) || !onlyKeys(body, ['currentPassword', 'code']) ||
      !validPassword(body.currentPassword) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
    return mfaError(422, 'VALIDATION_FAILED', 'Current password and a six-digit TOTP code are required')
  }

  const actor = await activeMfaPrincipal(request)
  if ('response' in actor) return actor.response
  const limitError = await enforceMfaAccountAndEndpointLimits(request, actor.principal.userId, 'authMfaDisable')
  if (limitError) return limitError

  const mfa = await requireVerifiedMfa(request)
  if ('response' in mfa) return mfa.response

  // Verify the step-up first. The single accepted time-step is consumed by W02
  // before Better Auth continues; an invalid password cannot disable the factor.
  const stepUp = await callFactor(request, '/two-factor/verify-totp', {
    code: body.code,
    trustDevice: false,
  })
  if ('response' in stepUp) return stepUp.response

  const disabled = await callFactor(request, '/two-factor/disable', {
    password: body.currentPassword,
  })
  if ('response' in disabled) return disabled.response

  // W02's D1 lifecycle trigger revokes sessions and clears enrolledAt. Never
  // forward any upstream session credential or factor internals.
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}
