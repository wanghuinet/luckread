import { describe, expect, it } from 'vitest'
import { parseEventEnvelopeMetadata } from './event-envelope.js'
import { QueueTaskFailure } from './retry-policy.js'

const validEvent = () => ({
  eventId: 'evt_001',
  eventType: 'identity.account_state_changed',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user_001',
  occurredAt: '2026-10-29T01:00:00.000Z',
  publishedAt: '2026-10-29T01:00:01.000Z',
  correlationId: 'trace/request 1',
  causationId: 'cause_001',
  idempotencyKey: 'idempotency_key_0001',
  attempt: 1,
  sourceVersion: 2,
  actor: { actorType: 'system' },
  before: { accountState: 'ACTIVE', accountStateVersion: 1 },
  after: { accountState: 'RESTRICTED', accountStateVersion: 2 },
  reason: 'policy-enforcement',
})

describe('W10 common event envelope metadata', () => {
  it('accepts known shared metadata and preserves event-specific fields unchanged', () => {
    const event = validEvent()
    expect(parseEventEnvelopeMetadata(event)).toBe(event)
    expect(parseEventEnvelopeMetadata(event).after).toEqual({
      accountState: 'RESTRICTED',
      accountStateVersion: 2,
    })
  })

  it('rejects non-object envelopes and missing shared fields as poison messages', () => {
    for (const value of [null, [], 'not-an-event', 42]) {
      expect(() => parseEventEnvelopeMetadata(value)).toThrowError(QueueTaskFailure)
    }

    const missingEventId = validEvent()
    delete (missingEventId as { eventId?: string }).eventId
    expect(() => parseEventEnvelopeMetadata(missingEventId)).toThrowError(
      'Event envelope metadata is invalid',
    )
  })

  it('rejects malformed resource IDs, event types, and idempotency keys', () => {
    for (const patch of [
      { eventId: 'bad id' },
      { resourceId: '../user' },
      { eventType: 'identity' },
      { idempotencyKey: 'short' },
      { idempotencyKey: 'not allowed!' },
    ]) {
      expect(() => parseEventEnvelopeMetadata({ ...validEvent(), ...patch })).toThrowError(
        'Event envelope metadata is invalid',
      )
    }
  })

  it('rejects impossible timestamps and invalid attempt/version values', () => {
    for (const patch of [
      { occurredAt: '2026-02-31T01:00:00Z' },
      { publishedAt: '2026-10-29' },
      { attempt: 0 },
      { attempt: 1.5 },
      { sourceVersion: -1 },
      { sourceVersion: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => parseEventEnvelopeMetadata({ ...validEvent(), ...patch })).toThrowError(
        'Event envelope metadata is invalid',
      )
    }
  })

  it('accepts RFC3339 timestamps with an explicit offset', () => {
    const event = {
      ...validEvent(),
      occurredAt: '2026-10-29T06:30:00+05:30',
      publishedAt: '2026-10-29T06:30:01+05:30',
    }
    expect(parseEventEnvelopeMetadata(event)).toBe(event)
  })
})
