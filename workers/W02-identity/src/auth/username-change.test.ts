import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveBetterAuthPrincipal: vi.fn() }))
vi.mock('./principal.js', () => ({ resolveBetterAuthPrincipal: mocks.resolveBetterAuthPrincipal }))

import type { BetterAuthEnv } from './better-auth.js'
import {
  fingerprintUsernameChange, hashUsernameIdempotencyKey,
  handleUsernameChangeRequest, handleUsernameStateRequest,
  isReservedUsername, normalizeUsernameCandidate,
} from './username-change.js'

const activePrincipal = {
  userId: 'user-123', email: 'user@example.com', sessionId: 'session-123',
  accountState: 'ACTIVE', accountStateVersion: 1, layer: 'L2', roleAssignments: [],
}
type TestRow = {
  username: string | null
  accountState: string
  usernameVersion: number
  lastChangedAt: string | null
  replayKeyHash: string | null
  replayUsername: string | null
  replayFingerprint: string | null
  replayChangedAt: string | null
  replayExpiresAt: string | null
}

const defaultRow: TestRow = {
  username: 'OldHandle', accountState: 'ACTIVE', usernameVersion: 0, lastChangedAt: null,
  replayKeyHash: null, replayUsername: null, replayFingerprint: null, replayChangedAt: null, replayExpiresAt: null,
}

function createEnv(row: TestRow = { ...defaultRow }) {
  const prepared: Array<{ sql: string; args: unknown[] }> = []
  const batch = vi.fn(async (_statements: unknown[]) => [
    { success: true, meta: { changes: 0 } },
    { success: true, meta: { changes: 1 } },
    { success: true, meta: { changes: 1 } },
  ])
  const database = {
    prepare(sql: string) {
      const statement = {
        sql, args: [] as unknown[],
        bind(...args: unknown[]) { this.args = args; return this },
        async first() { return row },
      }
      prepared.push(statement)
      return statement
    },
    batch,
  }
  const limiter = { limit: vi.fn().mockResolvedValue({ success: true }) }
  return {
    env: { D1_01: database, AUTH_SESSION_READ_LIMITER: limiter, AUTH_SESSION_WRITE_LIMITER: limiter } as unknown as BetterAuthEnv,
    prepared, limiter, database, batch,
  }
}

function changeRequest(input: { username?: string; ifMatch?: string; idempotencyKey?: string } = {}): Request {
  return new Request('https://luckread-w02.internal/internal/auth/username/change', {
    method: 'POST',
    headers: {
      'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0',
      'Idempotency-Key': input.idempotencyKey ?? 'username-change-key-0001',
      'If-Match': input.ifMatch ?? '"username-v0"', 'content-type': 'application/json',
    },
    body: JSON.stringify({ username: input.username ?? 'NewHandle' }),
  })
}

describe('W02 username change authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveBetterAuthPrincipal.mockResolvedValue(activePrincipal)
  })

  it('normalizes accepted ASCII handles and rejects Unicode lookalikes', () => {
    expect(normalizeUsernameCandidate('  NewHandle  ')).toEqual({ display: 'NewHandle', normalized: 'newhandle' })
    expect(normalizeUsernameCandidate('NéwHandle')).toBeNull()
    expect(normalizeUsernameCandidate('Short')).toBeNull()
  })

  it('reserves exact normalized platform and route names without reserving prefixes', () => {
    expect(isReservedUsername('luckreadofficial')).toBe(true)
    expect(isReservedUsername('adminpanel')).toBe(true)
    expect(isReservedUsername('ordinaryluckreadfan')).toBe(false)
  })

  it('returns the W02 username version as an ETag', async () => {
    const { env } = createEnv()
    const request = new Request('https://luckread-w02.internal/internal/auth/username/state', {
      headers: { 'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0' },
    })
    const response = await handleUsernameStateRequest(env, request)
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"username-v0"')
    expect(await response.json()).toMatchObject({ data: { username: 'OldHandle', usernameVersion: 0, lastChangedAt: null, canChangeAt: null } })
  })

  it('rejects reserved handles before persistence', async () => {
    const { env, batch } = createEnv()
    const response = await handleUsernameChangeRequest(env, changeRequest({ username: 'Support' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'USERNAME_RESERVED' } })
    expect(batch).not.toHaveBeenCalled()
  })

  it('enforces the 30-day cooldown from the last successful change', async () => {
    const { env, batch } = createEnv({ ...defaultRow, usernameVersion: 1, lastChangedAt: '2026-10-20T12:00:00.000Z' })
    const response = await handleUsernameChangeRequest(env, changeRequest({ ifMatch: '"username-v1"' }), new Date('2026-11-02T12:00:00.000Z'))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'USERNAME_CHANGE_COOLDOWN' } })
    expect(batch).not.toHaveBeenCalled()
  })

  it('allows a username change when the 30-day cooldown has expired', async () => {
    const { env, batch, prepared } = createEnv({ ...defaultRow, usernameVersion: 1, lastChangedAt: '2026-10-03T12:00:00.000Z' })
    const response = await handleUsernameChangeRequest(env, changeRequest({ ifMatch: '"username-v1"' }), new Date('2026-11-02T12:00:00.000Z'))
    expect(response.status).toBe(200)
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toHaveLength(3)
    expect(prepared[1].sql).toContain('previous_username_normalized')
    expect(prepared[1].sql).toContain('previous_username_expires_at > ?')
  })

  it('rejects stale If-Match versions', async () => {
    const { env, batch } = createEnv({ ...defaultRow, usernameVersion: 2 })
    const response = await handleUsernameChangeRequest(env, changeRequest({ ifMatch: '"username-v1"' }))
    expect(response.status).toBe(412)
    expect(response.headers.get('etag')).toBe('"username-v2"')
    expect(batch).not.toHaveBeenCalled()
  })

  it('replays a successful idempotent operation without another write', async () => {
    const keyHash = await hashUsernameIdempotencyKey('username-change-key-0001')
    const fingerprint = await fingerprintUsernameChange('NewHandle', '"username-v0"')
    const { env, batch } = createEnv({
      ...defaultRow, username: 'NewHandle', usernameVersion: 1,
      replayKeyHash: keyHash, replayUsername: 'NewHandle', replayFingerprint: fingerprint,
      replayChangedAt: '2026-11-02T12:00:00.000Z',
      replayExpiresAt: '2026-11-03T12:00:00.000Z',
    })
    const response = await handleUsernameChangeRequest(env, changeRequest(), new Date('2026-11-02T12:05:00.000Z'))
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"username-v1"')
    expect(await response.json()).toMatchObject({ meta: { idempotentReplay: true } })
    expect(batch).not.toHaveBeenCalled()
  })

  it('rejects reuse of a live idempotency key with different intent', async () => {
    const keyHash = await hashUsernameIdempotencyKey('username-change-key-0001')
    const { env, batch } = createEnv({
      ...defaultRow, replayKeyHash: keyHash, replayUsername: 'NewHandle', replayFingerprint: '0'.repeat(64),
      replayChangedAt: '2026-11-02T12:00:00.000Z',
      replayExpiresAt: '2026-11-03T12:00:00.000Z',
    })
    const response = await handleUsernameChangeRequest(env, changeRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT' } })
    expect(batch).not.toHaveBeenCalled()
  })

  it('writes one compact per-user state row rather than an append-only history log', async () => {
    const { env, batch, prepared, limiter } = createEnv()
    const response = await handleUsernameChangeRequest(env, changeRequest(), new Date('2026-11-02T12:00:00.000Z'))
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"username-v1"')
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toHaveLength(3)
    expect(prepared[1].sql).toContain('UPDATE "user"')
    expect(prepared[2].sql).toContain('INSERT INTO auth_username_change_state')
    expect(prepared[3].sql).toContain('UPDATE auth_username_change_state SET previous_username = NULL')
    expect(limiter.limit).toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      data: {
        username: 'NewHandle', usernameVersion: 1,
        changedAt: '2026-11-02T12:00:00.000Z',
        previousUsernameReservedUntil: '2026-12-02T12:00:00.000Z',
      },
      meta: { idempotentReplay: false },
    })
  })

  it('fails closed when the existing write limiter is unavailable', async () => {
    const { env, batch, limiter } = createEnv()
    limiter.limit.mockRejectedValueOnce(new Error('limiter unavailable'))
    const response = await handleUsernameChangeRequest(env, changeRequest())
    expect(response.status).toBe(503)
    expect(batch).not.toHaveBeenCalled()
  })
})
