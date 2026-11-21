export type CreatorDecisionAdmission = 'DECIDE' | 'REPLAY' | 'SELF_APPROVAL_DENIED' | 'DECISION_CONFLICT'

export function creatorApplicationReplayMatches(
  existing: { creator_type: string; statement: string },
  requested: { creatorType: string; statement: string },
): boolean {
  return existing.creator_type === requested.creatorType && existing.statement === requested.statement
}

export function admitCreatorDecision(input: {
  applicationStatus: string
  requestedDecision: 'APPROVED' | 'REJECTED'
  applicantId: string
  actorId: string
  storedDecision: string | null
  storedActorId: string | null
  storedIdempotencyKey: string | null
  requestIdempotencyKey: string
}): CreatorDecisionAdmission {
  if (input.applicantId === input.actorId) return 'SELF_APPROVAL_DENIED'
  if (input.applicationStatus === 'PENDING') return 'DECIDE'
  if (
    input.applicationStatus === input.requestedDecision &&
    input.storedDecision === input.requestedDecision &&
    input.storedActorId === input.actorId &&
    input.storedIdempotencyKey === input.requestIdempotencyKey
  ) return 'REPLAY'
  return 'DECISION_CONFLICT'
}

export function parseExpectedVersion(value: string | null): number | null {
  if (!value) return null
  // If-Match uses strong entity-tags; this endpoint emits a single strong ETag such as "3".
  // Reject weak tags, wildcards, lists, and bare numbers rather than weakening concurrency checks.
  const match = /^"([1-9][0-9]*)"$/.exec(value.trim())
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : null
}

export function validIdempotencyKey(value: string | null): value is string {
  return !!value && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value)
}
