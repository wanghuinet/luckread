const MAX_REQUEST_LIFETIME_MS = 4 * 60 * 60 * 1000

/**
 * Static, read-only validation for the checked-in one-time L8 bootstrap request.
 * W02 remains authoritative: it additionally binds the file to the merged PR,
 * signed workflow run, protected Environment approval, target identity and
 * one-time D1 audit guard. This helper must never perform network or DB writes.
 */
export function validateL8GenesisBootstrapRequest(request, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return { valid: false, reason: 'INVALID_CLOCK' }
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { valid: false, reason: 'MISSING_OR_INVALID_REQUEST' }
  }
  if (
    request.version !== 1 ||
    request.operation !== 'INITIAL_L8_BOOTSTRAP' ||
    typeof request.targetUserId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(request.targetUserId) ||
    request.roleId !== 'super_admin' ||
    request.scopeType !== 'global' ||
    request.scopeId !== null ||
    typeof request.reason !== 'string' ||
    request.reason.trim().length < 10 ||
    request.reason.length > 512 ||
    typeof request.nonce !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(request.nonce) ||
    typeof request.createdAt !== 'string' ||
    typeof request.expiresAt !== 'string'
  ) {
    return { valid: false, reason: 'REQUEST_SCHEMA_INVALID' }
  }

  const createdAt = Date.parse(request.createdAt)
  const expiresAt = Date.parse(request.expiresAt)
  const nowMs = now.getTime()
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    return { valid: false, reason: 'REQUEST_INTERVAL_INVALID' }
  }
  if (createdAt > nowMs) {
    return { valid: false, reason: 'REQUEST_NOT_YET_VALID' }
  }
  if (expiresAt <= nowMs) {
    return { valid: false, reason: 'REQUEST_EXPIRED' }
  }
  if (expiresAt - createdAt > MAX_REQUEST_LIFETIME_MS) {
    return { valid: false, reason: 'REQUEST_LIFETIME_EXCEEDS_LIMIT' }
  }

  return { valid: true, reason: null }
}
