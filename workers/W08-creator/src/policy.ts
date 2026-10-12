export type Layer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8'

export function mayApplyForCreator(layer: string | null | undefined): boolean {
  // Only the verified global L2 user may request first-time L3 creator access.
  return layer === 'L2'
}

export function mayReviewCreatorApplication(layer: string | null | undefined): boolean {
  return layer === 'L7' || layer === 'L8'
}

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
  const normalized = value.trim().replace(/^W[/]/, '').replace(/^"|"$/g, '')
  if (!/^[1-9][0-9]*$/.test(normalized)) return null
  const version = Number(normalized)
  return Number.isSafeInteger(version) ? version : null
}

export function validIdempotencyKey(value: string | null): value is string {
  return !!value && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value)
}
