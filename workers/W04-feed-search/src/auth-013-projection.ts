import type { KVNamespace } from '@cloudflare/workers-types'

export type AccountState =
  | 'UNREGISTERED' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'RESTRICTED' | 'FROZEN'
  | 'SUSPENDED' | 'BANNED' | 'DELETION_REQUESTED' | 'DELETION_PENDING' | 'DELETED'
  | 'RESTORED' | 'REACTIVATED'

export interface AccountStateChangedEvent {
  eventId: string
  eventType: 'identity.account_state_changed'
  schemaVersion: '1.0'
  producer: 'W02'
  resourceType: 'User'
  resourceId: string
  occurredAt: string
  publishedAt: string
  correlationId: string
  causationId: string
  idempotencyKey: string
  attempt: number
  sourceVersion: number
  actor: Record<string, unknown>
  before: { accountState: AccountState; accountStateVersion: number }
  after: { accountState: AccountState; accountStateVersion: number }
  reason: string
}

export interface ProjectionRecord {
  schemaVersion: 1
  resourceType: 'User'
  resourceId: string
  sourceAuthority: 'D1-01'
  sourceVersion: number
  eventId: string
  projectionVersion: number
  accountState: AccountState
  state: 'ACTIVE' | 'STALE' | 'PURGED'
  deindex: boolean
  createdAt: string
  staleAfter: string
  policyVersion: 'AUTH-013-v1'
}

const DEINDEX_STATES = new Set<AccountState>([
  'FROZEN', 'SUSPENDED', 'BANNED', 'DELETION_PENDING', 'DELETED',
])
const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function parseAccountStateChanged(value: unknown): AccountStateChangedEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_AUTH_013_EVENT')
  const input = value as Record<string, unknown>
  const before = input.before
  const after = input.after
  if (
    input.eventType !== 'identity.account_state_changed' ||
    input.schemaVersion !== '1.0' ||
    input.producer !== 'W02' ||
    input.resourceType !== 'User' ||
    typeof input.eventId !== 'string' || !resourceIdPattern.test(input.eventId) ||
    typeof input.resourceId !== 'string' || !resourceIdPattern.test(input.resourceId) ||
    typeof input.sourceVersion !== 'number' || !Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1 ||
    typeof input.attempt !== 'number' || !Number.isSafeInteger(input.attempt) || input.attempt < 1 ||
    !before || typeof before !== 'object' || !after || typeof after !== 'object'
  ) throw new Error('INVALID_AUTH_013_EVENT')
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  if (
    typeof b.accountState !== 'string' || typeof b.accountStateVersion !== 'number' ||
    !Number.isSafeInteger(b.accountStateVersion) || b.accountStateVersion < 1 ||
    typeof a.accountState !== 'string' || typeof a.accountStateVersion !== 'number' ||
    !Number.isSafeInteger(a.accountStateVersion) || a.accountStateVersion < 1 ||
    a.accountStateVersion !== input.sourceVersion
  ) throw new Error('INVALID_AUTH_013_EVENT')
  return value as AccountStateChangedEvent
}

export async function applyAccountStateProjection(
  kv: Pick<KVNamespace, 'get' | 'put'>,
  event: AccountStateChangedEvent,
  now = new Date(),
): Promise<'applied' | 'ignored'> {
  const key = `auth013:projection:${event.resourceType}:${event.resourceId}`
  const current = await kv.get(key, 'json') as ProjectionRecord | null
  if (current && current.sourceVersion >= event.sourceVersion) return 'ignored'

  const deindex = DEINDEX_STATES.has(event.after.accountState)
  const createdAt = now.toISOString()
  const staleAfter = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
  const record: ProjectionRecord = {
    schemaVersion: 1,
    resourceType: 'User',
    resourceId: event.resourceId,
    sourceAuthority: 'D1-01',
    sourceVersion: event.sourceVersion,
    eventId: event.eventId,
    projectionVersion: event.after.accountStateVersion,
    accountState: event.after.accountState,
    state: deindex ? 'PURGED' : 'ACTIVE',
    deindex,
    createdAt,
    staleAfter,
    policyVersion: 'AUTH-013-v1',
  }
  await kv.put(key, JSON.stringify(record))
  return 'applied'
}
