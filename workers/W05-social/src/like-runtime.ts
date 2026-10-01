export type AntiAbuseAdmission = 'ALLOW' | 'THROTTLE' | 'CHALLENGE' | 'BLOCK' | 'REVIEW'

export type TrustedLikeAdmission = {
  caller: string
  transportVersion: string
  correlationId: string
  actorUserId: string
  resourceType: 'content'
  resourceId: string
  actorAccountState: string
  resourceVisible: boolean
  resourceInteractable: boolean
  blockPolicyAllows: boolean
  mutePolicyAllows: boolean
  antiAbuseAdmission: AntiAbuseAdmission
  idempotencyKey: string
}

export type LikeMutationResult = {
  likeId: string | null
  actorUserId: string
  resourceType: 'content'
  resourceId: string
  created: boolean
  removed: boolean
}

type RunResult = { meta?: { changes?: number } }
type Statement = {
  bind(...values: unknown[]): Statement
  run(): Promise<RunResult>
}
export interface LikeDatabase { prepare(sql: string): Statement }

export class LikeAdmissionError extends Error {
  constructor(readonly code: string) { super(code) }
}

const validId = (value: string): boolean => value.length > 0 && value.length <= 128

export function validateTrustedLikeAdmission(
  input: TrustedLikeAdmission,
  operation: 'like' | 'unlike',
): void {
  if (input.caller !== 'W01') throw new LikeAdmissionError('UNTRUSTED_CALLER')
  if (input.transportVersion !== '1.0') throw new LikeAdmissionError('UNSUPPORTED_TRANSPORT')
  if (!validId(input.actorUserId) || !validId(input.resourceId)) {
    throw new LikeAdmissionError('INVALID_PRINCIPAL')
  }
  if (!input.correlationId || input.correlationId.length > 128) {
    throw new LikeAdmissionError('INVALID_CORRELATION')
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 256) {
    throw new LikeAdmissionError('IDEMPOTENCY_KEY_REQUIRED')
  }
  if (input.actorAccountState !== 'ACTIVE') {
    throw new LikeAdmissionError('ACCOUNT_NOT_ACTIVE')
  }
  if (input.blockPolicyAllows === false) {
    throw new LikeAdmissionError('BLOCK_POLICY_DENIED')
  }
  if (operation === 'like') {
    if (!input.resourceVisible) throw new LikeAdmissionError('RESOURCE_NOT_VISIBLE')
    if (!input.resourceInteractable) throw new LikeAdmissionError('RESOURCE_NOT_INTERACTABLE')
    if (!input.mutePolicyAllows) throw new LikeAdmissionError('MUTE_POLICY_DENIED')
    if (input.antiAbuseAdmission !== 'ALLOW') {
      throw new LikeAdmissionError('ANTI_ABUSE_DENIED')
    }
  }
}

export async function likeResource(
  db: LikeDatabase,
  input: TrustedLikeAdmission,
): Promise<LikeMutationResult> {
  validateTrustedLikeAdmission(input, 'like')

  const likeId = crypto.randomUUID()
  const result = await db.prepare(
    'INSERT OR IGNORE INTO social_like_relationships (like_id, actor_user_id, resource_type, resource_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(
    likeId,
    input.actorUserId,
    input.resourceType,
    input.resourceId,
    new Date().toISOString(),
  ).run()

  return {
    likeId: (result.meta?.changes ?? 0) > 0 ? likeId : null,
    actorUserId: input.actorUserId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    created: (result.meta?.changes ?? 0) > 0,
    removed: false,
  }
}

export async function unlikeResource(
  db: LikeDatabase,
  input: TrustedLikeAdmission,
): Promise<LikeMutationResult> {
  validateTrustedLikeAdmission(input, 'unlike')

  const result = await db.prepare(
    'DELETE FROM social_like_relationships WHERE actor_user_id = ? AND resource_type = ? AND resource_id = ?',
  ).bind(input.actorUserId, input.resourceType, input.resourceId).run()

  return {
    likeId: null,
    actorUserId: input.actorUserId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    created: false,
    removed: (result.meta?.changes ?? 0) > 0,
  }
}

export function mapLikeError(error: unknown): { status: number; code: string } {
  const code = error instanceof LikeAdmissionError ? error.code : 'SERVICE_UNAVAILABLE'
  const status =
    code === 'UNTRUSTED_CALLER' || code === 'UNSUPPORTED_TRANSPORT' ||
    code === 'INVALID_PRINCIPAL' || code === 'INVALID_CORRELATION' ||
    code === 'IDEMPOTENCY_KEY_REQUIRED'
      ? 400
      : code === 'ACCOUNT_NOT_ACTIVE' || code === 'RESOURCE_NOT_VISIBLE' ||
        code === 'RESOURCE_NOT_INTERACTABLE' || code === 'BLOCK_POLICY_DENIED' ||
        code === 'MUTE_POLICY_DENIED' || code === 'ANTI_ABUSE_DENIED'
        ? 403
        : 503
  return { status, code }
}
