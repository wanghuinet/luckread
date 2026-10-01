export type AntiAbuseAdmission = 'ALLOW' | 'THROTTLE' | 'CHALLENGE' | 'BLOCK' | 'REVIEW'

export type TrustedFollowAdmission = {
  caller: string
  transportVersion: string
  correlationId: string
  actorUserId: string
  targetUserId: string
  actorAccountState: string
  targetFollowability: boolean
  blockPolicyAllows: boolean
  privacyScopeAllows: boolean
  antiAbuseAdmission: AntiAbuseAdmission
  idempotencyKey: string
}

export type FollowMutationResult = {
  relationshipId: string | null
  followerUserId: string
  targetUserId: string
  created: boolean
  removed: boolean
}

type RunResult = { success?: boolean; meta?: { changes?: number } }
type Statement = {
  bind(...values: unknown[]): Statement
  run(): Promise<RunResult>
  first<T>(): Promise<T | null>
}
export interface FollowDatabase { prepare(sql: string): Statement }

export class FollowAdmissionError extends Error {
  constructor(readonly code: string) { super(code) }
}

const MAX_ID = 128
const validId = (value: string): boolean => value.length > 0 && value.length <= MAX_ID

export function validateTrustedFollowAdmission(input: TrustedFollowAdmission, operation: 'follow' | 'unfollow'): void {
  if (input.caller !== 'W01') throw new FollowAdmissionError('UNTRUSTED_CALLER')
  if (input.transportVersion !== '1.0') throw new FollowAdmissionError('UNSUPPORTED_TRANSPORT')
  if (!validId(input.actorUserId) || !validId(input.targetUserId)) throw new FollowAdmissionError('INVALID_PRINCIPAL')
  if (!input.correlationId || input.correlationId.length > 128) throw new FollowAdmissionError('INVALID_CORRELATION')
  if (!input.idempotencyKey || input.idempotencyKey.length > 256) throw new FollowAdmissionError('IDEMPOTENCY_KEY_REQUIRED')
  if (input.actorAccountState !== 'ACTIVE') throw new FollowAdmissionError('ACCOUNT_NOT_ACTIVE')
  if (!input.blockPolicyAllows) throw new FollowAdmissionError('BLOCK_POLICY_DENIED')
  if (operation === 'follow') {
    if (!input.targetFollowability) throw new FollowAdmissionError('TARGET_NOT_FOLLOWABLE')
    if (!input.privacyScopeAllows) throw new FollowAdmissionError('PRIVACY_SCOPE_DENIED')
  }
  if (input.antiAbuseAdmission !== 'ALLOW') throw new FollowAdmissionError('ANTI_ABUSE_DENIED')
}

export async function followUser(db: FollowDatabase, input: TrustedFollowAdmission): Promise<FollowMutationResult> {
  validateTrustedFollowAdmission(input, 'follow')
  if (input.actorUserId === input.targetUserId) throw new FollowAdmissionError('SELF_FOLLOW_DENIED')
  const relationshipId = crypto.randomUUID()
  const result = await db.prepare(
    'INSERT OR IGNORE INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES (?, ?, ?, ?)',
  ).bind(relationshipId, input.actorUserId, input.targetUserId, new Date().toISOString()).run()
  if ((result.meta?.changes ?? 0) > 0) {
    return { relationshipId, followerUserId: input.actorUserId, targetUserId: input.targetUserId, created: true, removed: false }
  }
  const existing = await db.prepare(
    'SELECT relationship_id AS relationshipId FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ?',
  ).bind(input.actorUserId, input.targetUserId).first<{ relationshipId: string }>()
  if (!existing?.relationshipId) throw new FollowAdmissionError('CONCURRENCY_CONFLICT')
  return { relationshipId: existing.relationshipId, followerUserId: input.actorUserId, targetUserId: input.targetUserId, created: false, removed: false }
}

export async function unfollowUser(db: FollowDatabase, input: TrustedFollowAdmission): Promise<FollowMutationResult> {
  validateTrustedFollowAdmission(input, 'unfollow')
  if (input.actorUserId === input.targetUserId) throw new FollowAdmissionError('SELF_FOLLOW_DENIED')
  const result = await db.prepare(
    'DELETE FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ?',
  ).bind(input.actorUserId, input.targetUserId).run()
  return { relationshipId: null, followerUserId: input.actorUserId, targetUserId: input.targetUserId, created: false, removed: (result.meta?.changes ?? 0) > 0 }
}

export function mapFollowError(error: unknown): { status: number; code: string } {
  const code = error instanceof FollowAdmissionError ? error.code : 'SERVICE_UNAVAILABLE'
  const status =
    code === 'UNTRUSTED_CALLER' || code === 'UNSUPPORTED_TRANSPORT' || code === 'INVALID_PRINCIPAL' ||
    code === 'INVALID_CORRELATION' || code === 'IDEMPOTENCY_KEY_REQUIRED' ? 400 :
    code === 'ACCOUNT_NOT_ACTIVE' || code === 'TARGET_NOT_FOLLOWABLE' || code === 'BLOCK_POLICY_DENIED' ||
    code === 'PRIVACY_SCOPE_DENIED' || code === 'ANTI_ABUSE_DENIED' ? 403 :
    code === 'SELF_FOLLOW_DENIED' ? 422 :
    code === 'CONCURRENCY_CONFLICT' ? 409 : 503
  return { status, code }
}
