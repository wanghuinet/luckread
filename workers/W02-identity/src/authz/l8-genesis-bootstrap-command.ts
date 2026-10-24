import layers from '../../../../contracts/authz/layers.json'
import type { VerifiedL8BootstrapApproval } from './l8-genesis-bootstrap-approval.js'
import { readRoleVersion } from './role-version.js'

type ExistingAudit = {
  requestPrNumber: number
  requestHeadSha: string
  requestMergeSha: string
  targetUserId: string
  assignmentId: string
  nonceSha256: string
  validFrom: string
  validUntil: string
}

type ExistingAssignment = {
  id: string
  subjectId: string
  roleId: string
  scopeType: string
  scopeId: string | null
  status: string
  validFrom: string
  validUntil: string | null
}

export class L8BootstrapCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const nonceSha256 = async (nonce: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const roleToLayer = new Map<string, string>()
const mfaRequiredByLayer = new Map<string, boolean>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleToLayer.set(role, layer.id)
  mfaRequiredByLayer.set(layer.id, layer.mfa === true)
}

export async function bootstrapSuperAdmin(
  db: D1Database,
  approval: VerifiedL8BootstrapApproval,
  now = new Date().toISOString(),
): Promise<{
  assignmentId: string
  targetUserId: string
  roleId: 'super_admin'
  validFrom: string
  validUntil: string
  replayed: boolean
  roleVersion: number
}> {
  const request = approval?.request
  if (
    !request ||
    request.operation !== 'INITIAL_L8_BOOTSTRAP' ||
    request.roleId !== 'super_admin' ||
    request.scopeType !== 'global' ||
    request.scopeId !== null ||
    roleToLayer.get('super_admin') !== 'L8' ||
    mfaRequiredByLayer.get('L8') !== true ||
    typeof request.targetUserId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(request.targetUserId) ||
    typeof request.nonce !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(request.nonce) ||
    !Number.isSafeInteger(approval.requestPrNumber) ||
    approval.requestPrNumber < 1 ||
    !/^[0-9a-f]{40}$/i.test(approval.requestHeadSha) ||
    !/^[0-9a-f]{40}$/i.test(approval.requestMergeSha) ||
    !/^[0-9]+$/.test(approval.workflowRunId) ||
    new Set(approval.approvedReviewers.map((value) => value.toLowerCase())).size < 2 ||
    Object.keys(approval.reviewerPermissions).length < 2 ||
    Number.isNaN(Date.parse(now))
  ) {
    throw new L8BootstrapCommandError('VALIDATION_FAILED', 'invalid verified L8 bootstrap command')
  }

  const createdAt = Date.parse(request.createdAt)
  const expiresAt = Date.parse(request.expiresAt)
  const nowMs = Date.parse(now)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt || expiresAt <= nowMs || createdAt > nowMs) {
    throw new L8BootstrapCommandError('REQUEST_EXPIRED_OR_INVALID', 'approved bootstrap request is outside its validity interval')
  }

  const hashedNonce = await nonceSha256(request.nonce)
  const assignmentId = 'ra-l8g-' + approval.requestPrNumber + '-' + hashedNonce.slice(0, 24)
  const validUntil = new Date(nowMs + 4 * 60 * 60 * 1000).toISOString()

  const existingAudit = await db.prepare(
    'SELECT request_pr_number AS requestPrNumber, request_head_sha AS requestHeadSha, ' +
    'request_merge_sha AS requestMergeSha, target_user_id AS targetUserId, ' +
    'role_assignment_id AS assignmentId, nonce_sha256 AS nonceSha256, ' +
    'valid_from AS validFrom, valid_until AS validUntil ' +
    'FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = ? LIMIT 1',
  ).bind('first-l8').first<ExistingAudit>()

  if (existingAudit) {
    const sameRequest =
      existingAudit.requestPrNumber === approval.requestPrNumber &&
      existingAudit.requestHeadSha === approval.requestHeadSha &&
      existingAudit.requestMergeSha === approval.requestMergeSha &&
      existingAudit.targetUserId === request.targetUserId &&
      existingAudit.nonceSha256 === hashedNonce &&
      existingAudit.assignmentId === assignmentId
    if (!sameRequest) {
      throw new L8BootstrapCommandError('BOOTSTRAP_ALREADY_CONSUMED', 'the one-time genesis bootstrap has already been consumed')
    }

    const persisted = await db.prepare(
      'SELECT id, subject_id AS subjectId, role_id AS roleId, scope_type AS scopeType, ' +
      'scope_id AS scopeId, status, valid_from AS validFrom, valid_until AS validUntil ' +
      'FROM role_assignments WHERE id = ? LIMIT 1',
    ).bind(existingAudit.assignmentId).first<ExistingAssignment>()

    if (
      persisted &&
      persisted.subjectId === request.targetUserId &&
      persisted.roleId === 'super_admin' &&
      persisted.scopeType === 'global' &&
      persisted.scopeId === null &&
      persisted.status === 'ACTIVE' &&
      persisted.validFrom === existingAudit.validFrom &&
      persisted.validUntil === existingAudit.validUntil &&
      now < existingAudit.validUntil
    ) {
      const roleVersion = await readRoleVersion(db, request.targetUserId)
      if (roleVersion < 1) {
        throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'bootstrap role version is missing')
      }
      return {
        assignmentId: persisted.id,
        targetUserId: request.targetUserId,
        roleId: 'super_admin',
        validFrom: persisted.validFrom,
        validUntil: existingAudit.validUntil,
        replayed: true,
        roleVersion,
      }
    }
    throw new L8BootstrapCommandError('BOOTSTRAP_ALREADY_CONSUMED', 'the bootstrap was already consumed and cannot be reissued')
  }

  const user = await db.prepare(
    'SELECT account_state AS accountState, email_verified AS emailVerified ' +
    'FROM "user" WHERE id = ? LIMIT 1',
  ).bind(request.targetUserId).first<{ accountState: string; emailVerified: number | boolean }>()
  if (!user || user.accountState !== 'ACTIVE' || !(user.emailVerified === true || user.emailVerified === 1)) {
    throw new L8BootstrapCommandError('TARGET_NOT_ELIGIBLE', 'target must be an ACTIVE email-verified account')
  }

  const hasVerifiedRole = await db.prepare(
    "SELECT id FROM role_assignments WHERE subject_id = ? AND role_id = 'verified_user' " +
    "AND scope_type = 'global' AND scope_id IS NULL AND status = 'ACTIVE' " +
    "AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
  ).bind(request.targetUserId, now, now).first<{ id: string }>()
  if (!hasVerifiedRole) {
    throw new L8BootstrapCommandError('VERIFIED_ROLE_REQUIRED', 'target must hold an effective L2 verified_user role')
  }

  const existingL8 = await db.prepare(
    "SELECT id FROM role_assignments WHERE role_id = 'super_admin' AND scope_type = 'global' " +
    "AND scope_id IS NULL AND status = 'ACTIVE' AND valid_from <= ? " +
    "AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
  ).bind(now, now).first<{ id: string }>()
  if (existingL8) {
    throw new L8BootstrapCommandError('L8_ALREADY_EXISTS', 'genesis bootstrap is only available before the first effective L8 assignment')
  }

  const reviewers = [...approval.approvedReviewers].map((login) => login.toLowerCase()).sort()
  const permissions = Object.fromEntries(
    Object.entries(approval.reviewerPermissions).map(([login, permission]) => [login.toLowerCase(), permission]),
  )

  try {
    await db.batch([
      db.prepare(
        'INSERT INTO l8_genesis_bootstrap_audit ' +
        '(bootstrap_key, operation, request_pr_number, request_head_sha, request_merge_sha, target_user_id, ' +
        'role_assignment_id, nonce_sha256, approved_reviewers_json, reviewer_permissions_json, workflow_run_id, ' +
        'valid_from, valid_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        'first-l8',
        'INITIAL_L8_BOOTSTRAP',
        approval.requestPrNumber,
        approval.requestHeadSha,
        approval.requestMergeSha,
        request.targetUserId,
        assignmentId,
        hashedNonce,
        JSON.stringify(reviewers),
        JSON.stringify(permissions),
        approval.workflowRunId,
        now,
        validUntil,
        now,
      ),
      db.prepare(
        "INSERT INTO role_assignments (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) " +
        "VALUES (?, ?, 'super_admin', 'global', NULL, 'ACTIVE', ?, ?, ?, ?)",
      ).bind(assignmentId, request.targetUserId, now, validUntil, now, now),
      // The existing D1 role_assignments INSERT trigger advances role_version
      // atomically in this same batch; do not increment it a second time.
    ])
  } catch {
    const raced = await db.prepare(
      'SELECT request_pr_number AS requestPrNumber, request_head_sha AS requestHeadSha, ' +
      'request_merge_sha AS requestMergeSha, target_user_id AS targetUserId, ' +
      'role_assignment_id AS assignmentId, nonce_sha256 AS nonceSha256, ' +
      'valid_from AS validFrom, valid_until AS validUntil ' +
      'FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = ? LIMIT 1',
    ).bind('first-l8').first<ExistingAudit>()
    if (raced) {
      if (
        raced.requestPrNumber === approval.requestPrNumber &&
        raced.requestHeadSha === approval.requestHeadSha &&
        raced.requestMergeSha === approval.requestMergeSha &&
        raced.targetUserId === request.targetUserId &&
        raced.nonceSha256 === hashedNonce &&
        raced.assignmentId === assignmentId &&
        now < raced.validUntil
      ) {
        const roleVersion = await readRoleVersion(db, request.targetUserId)
        if (roleVersion < 1) {
          throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'bootstrap role version is missing')
        }
        return {
          assignmentId: raced.assignmentId,
          targetUserId: request.targetUserId,
          roleId: 'super_admin',
          validFrom: raced.validFrom,
          validUntil: raced.validUntil,
          replayed: true,
          roleVersion,
        }
      }
      throw new L8BootstrapCommandError('BOOTSTRAP_ALREADY_CONSUMED', 'another genesis request has already consumed the one-time guard')
    }
    throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'L8 bootstrap transaction failed and was rolled back')
  }

  const persisted = await db.prepare(
    'SELECT id, subject_id AS subjectId, role_id AS roleId, scope_type AS scopeType, ' +
    'scope_id AS scopeId, status, valid_from AS validFrom, valid_until AS validUntil ' +
    'FROM role_assignments WHERE id = ? LIMIT 1',
  ).bind(assignmentId).first<ExistingAssignment>()
  const audit = await db.prepare(
    'SELECT role_assignment_id AS assignmentId FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = ? LIMIT 1',
  ).bind('first-l8').first<{ assignmentId: string }>()
  if (
    !persisted ||
    persisted.id !== assignmentId ||
    persisted.subjectId !== request.targetUserId ||
    persisted.roleId !== 'super_admin' ||
    persisted.scopeType !== 'global' ||
    persisted.scopeId !== null ||
    persisted.status !== 'ACTIVE' ||
    persisted.validFrom !== now ||
    persisted.validUntil !== validUntil ||
    audit?.assignmentId !== assignmentId
  ) {
    throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'persisted L8 bootstrap state failed read-back validation')
  }

  const roleVersion = await readRoleVersion(db, request.targetUserId)
  if (roleVersion < 1) {
    throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'bootstrap role version read-back failed')
  }

  return {
    assignmentId,
    targetUserId: request.targetUserId,
    roleId: 'super_admin',
    validFrom: now,
    validUntil,
    replayed: false,
    roleVersion,
  }
}
