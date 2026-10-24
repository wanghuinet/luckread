import layers from '../../../../contracts/authz/layers.json'
import type { VerifiedL8BootstrapApproval } from './l8-genesis-bootstrap-approval.js'

export class L8BootstrapReadinessError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/**
 * Read-only production preflight. This deliberately does not call the grant
 * command and never writes the D1 database. The write command rechecks every
 * mutable precondition to protect against races between preflight and commit.
 */
export async function checkL8BootstrapReadiness(
  db: D1Database,
  approval: VerifiedL8BootstrapApproval,
  now = new Date().toISOString(),
): Promise<{
  status: 'READY_FOR_BOOTSTRAP'
  targetUserId: string
  roleId: 'super_admin'
  scopeType: 'global'
  maxGrantSeconds: 14400
  requestPrNumber: number
  requestHeadSha: string
  requestMergeSha: string
  approvedReviewers: string[]
  productionMutationPerformed: false
}> {
  const request = approval?.request
  const parseNow = Date.parse(now)
  if (
    !request ||
    request.operation !== 'INITIAL_L8_BOOTSTRAP' ||
    request.roleId !== 'super_admin' ||
    request.scopeType !== 'global' ||
    request.scopeId !== null ||
    typeof request.targetUserId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(request.targetUserId) ||
    typeof request.nonce !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(request.nonce) ||
    !Number.isFinite(Date.parse(request.createdAt)) ||
    !Number.isFinite(Date.parse(request.expiresAt)) ||
    Date.parse(request.createdAt) > parseNow ||
    Date.parse(request.expiresAt) <= parseNow ||
    !Number.isSafeInteger(approval.requestPrNumber) ||
    approval.requestPrNumber < 1 ||
    !/^[a-f0-9]{40}$/i.test(approval.requestHeadSha) ||
    !/^[a-f0-9]{40}$/i.test(approval.requestMergeSha) ||
    !Array.isArray(approval.approvedReviewers) ||
    new Set(approval.approvedReviewers.map((name) => name.toLowerCase())).size < 2
  ) {
    throw new L8BootstrapReadinessError('REQUEST_EXPIRED_OR_INVALID', 'approved bootstrap request is invalid or expired')
  }

  const roleToLayer = new Map<string, string>()
  for (const layer of layers['x-layers']) {
    for (const role of layer.roles ?? []) roleToLayer.set(role, layer.id)
  }
  if (roleToLayer.get('super_admin') !== 'L8') {
    throw new L8BootstrapReadinessError('ROLE_MAPPING_INVALID', 'super_admin is not mapped to canonical L8')
  }

  // These no-op SELECTs prove that the deployed D1 schema has all fields and
  // tables required by the command and by the verified-TOTP privilege gate.
  try {
    await Promise.all([
      db.prepare('SELECT two_factor_enabled, mfa_enrolled_at FROM "user" LIMIT 0').all(),
      db.prepare('SELECT userId, verified FROM "twoFactor" LIMIT 0').all(),
      db.prepare('SELECT bootstrap_key FROM l8_genesis_bootstrap_audit LIMIT 0').all(),
      db.prepare('SELECT role_id, valid_until FROM role_assignments LIMIT 0').all(),
    ])
  } catch {
    throw new L8BootstrapReadinessError('SCHEMA_NOT_READY', 'required MFA or L8 bootstrap schema is missing')
  }

  const lifecycleTriggers = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (?, ?)",
  ).bind('user_mfa_enable_revoke_sessions', 'user_mfa_disable_clear_enrollment').all<{ name: string }>()
  const installedTriggers = new Set(lifecycleTriggers.results.map((trigger) => trigger.name))
  if (
    !installedTriggers.has('user_mfa_enable_revoke_sessions') ||
    !installedTriggers.has('user_mfa_disable_clear_enrollment')
  ) {
    throw new L8BootstrapReadinessError(
      'SCHEMA_NOT_READY',
      'MFA lifecycle session-revocation triggers are missing',
    )
  }

  const target = await db.prepare(
    'SELECT account_state AS accountState, email_verified AS emailVerified ' +
    'FROM "user" WHERE id = ? LIMIT 1',
  ).bind(request.targetUserId).first<{ accountState: string; emailVerified: number | boolean }>()
  if (!target || target.accountState !== 'ACTIVE' || !(target.emailVerified === true || target.emailVerified === 1)) {
    throw new L8BootstrapReadinessError('TARGET_NOT_ELIGIBLE', 'target must be an ACTIVE email-verified account')
  }

  const l2 = await db.prepare(
    "SELECT id FROM role_assignments WHERE subject_id = ? AND role_id = 'verified_user' " +
    "AND scope_type = 'global' AND scope_id IS NULL AND status = 'ACTIVE' " +
    "AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
  ).bind(request.targetUserId, now, now).first<{ id: string }>()
  if (!l2) {
    throw new L8BootstrapReadinessError('VERIFIED_ROLE_REQUIRED', 'target must hold an effective L2 verified_user role')
  }

  const l8 = await db.prepare(
    "SELECT id FROM role_assignments WHERE role_id = 'super_admin' AND scope_type = 'global' " +
    "AND scope_id IS NULL AND status = 'ACTIVE' AND valid_from <= ? " +
    "AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
  ).bind(now, now).first<{ id: string }>()
  if (l8) {
    throw new L8BootstrapReadinessError('L8_ALREADY_EXISTS', 'an effective global L8 already exists')
  }

  const consumed = await db.prepare(
    'SELECT bootstrap_key FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = ? LIMIT 1',
  ).bind('first-l8').first<{ bootstrap_key: string }>()
  if (consumed) {
    throw new L8BootstrapReadinessError('BOOTSTRAP_ALREADY_CONSUMED', 'the one-time L8 bootstrap guard has already been consumed')
  }

  return {
    status: 'READY_FOR_BOOTSTRAP',
    targetUserId: request.targetUserId,
    roleId: 'super_admin',
    scopeType: 'global',
    maxGrantSeconds: 14400,
    requestPrNumber: approval.requestPrNumber,
    requestHeadSha: approval.requestHeadSha,
    requestMergeSha: approval.requestMergeSha,
    approvedReviewers: [...approval.approvedReviewers].map((name) => name.toLowerCase()).sort(),
    productionMutationPerformed: false,
  }
}
