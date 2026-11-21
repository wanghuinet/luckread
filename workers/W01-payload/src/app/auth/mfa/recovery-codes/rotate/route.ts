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
} from '../../shared.js'

export async function POST(request: Request): Promise<Response> {
  const edgeError = await enforceMfaEdgeLimit(request)
  if (edgeError) return edgeError

  let body: unknown
  try { body = await request.json() } catch {
    return mfaError(422, 'VALIDATION_FAILED', 'Invalid recovery-code rotation request')
  }
  if (!isRecord(body) || !onlyKeys(body, ['currentPassword', 'code']) ||
      !validPassword(body.currentPassword) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
    return mfaError(422, 'VALIDATION_FAILED', 'Current password and a six-digit TOTP code are required')
  }

  const actor = await activeMfaPrincipal(request)
  if ('response' in actor) return actor.response
  const limitError = await enforceMfaAccountAndEndpointLimits(request, actor.principal.userId, 'authMfaRecoveryCodesRotate')
  if (limitError) return limitError

  const mfa = await requireVerifiedMfa(request)
  if ('response' in mfa) return mfa.response

  const stepUp = await callFactor(request, '/two-factor/verify-totp', {
    code: body.code,
    trustDevice: false,
  })
  if ('response' in stepUp) return stepUp.response

  const generated = await callFactor(request, '/two-factor/generate-backup-codes', {
    password: body.currentPassword,
  })
  if ('response' in generated) return generated.response

  let payload: unknown
  try { payload = await generated.json() } catch {
    return mfaError(503, 'SERVICE_UNAVAILABLE', 'Recovery codes could not be rotated')
  }
  if (!isRecord(payload) || !Array.isArray(payload.backupCodes) ||
      payload.backupCodes.length < 1 || payload.backupCodes.length > 32 ||
      !payload.backupCodes.every((value) => typeof value === 'string' && value.length >= 1 && value.length <= 128)) {
    return mfaError(503, 'SERVICE_UNAVAILABLE', 'Recovery codes could not be rotated')
  }

  // Better Auth encrypts the stored backup-code set; plaintext is returned
  // once and replaces every previous code.
  return Response.json(
    { data: { recoveryCodes: payload.backupCodes }, requestId: 'req_' + crypto.randomUUID() },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}
