import { describe, expect, it, vi } from 'vitest'

import { RegistrationRuntimeError, registerWithBetterAuth } from './registration-runtime.js'

type FakeRow = Record<string, unknown>
type FakeStatement = {
  sql: string
  values: unknown[]
  bind: (...values: unknown[]) => FakeStatement
  first: <T>() => Promise<T | null>
}

const makeDatabase = (
  state: {
    envelope: FakeRow | null
    user: FakeRow | null
  },
  options: { hideEnvelopeLookupByIdempotencyKey?: boolean } = {},
) => {
  const prepare = (sql: string): FakeStatement => {
    const statement: FakeStatement = {
      sql,
      values: [],
      bind(...values: unknown[]) {
        this.values = values
        return this
      },
      async first<T>() {
        if (sql.includes('FROM auth_registration_envelopes')) {
          if (
            options.hideEnvelopeLookupByIdempotencyKey &&
            sql.includes('WHERE idempotency_key = ?')
          ) {
            return null
          }
          return state.envelope as T | null
        }
        if (sql.includes('FROM "user" WHERE email = ?')) {
          return state.user as T | null
        }
        if (sql.includes('FROM "user" WHERE id = ?')) {
          return state.user as T | null
        }
        return null
      },
    }
    return statement
  }

  return {
    prepare,
    async batch(statements: FakeStatement[]) {
      if (statements.some((statement) => statement.sql.includes('INSERT INTO auth_registration_envelopes'))) {
        state.envelope = {
          id: 'env-1',
          payloadHash: 'hash-1',
          state: 'IN_PROGRESS',
          committedResponse: JSON.stringify({
            state: 'IN_PROGRESS',
            email: 'user@example.com',
            username: 'user1',
          }),
          expiresAt: '2099-01-01T00:00:00.000Z',
          consentRecordId: 'consent-1',
        }
        return [{ meta: { changes: 1 } }]
      }

      if (statements.some((statement) => statement.sql.includes('UPDATE auth_registration_envelopes'))) {
        state.envelope = {
          id: 'env-1',
          payloadHash: 'hash-1',
          state: 'COMPLETED',
          committedResponse: JSON.stringify({
            userId: 'user-1',
            accountState: 'PENDING_VERIFICATION',
          }),
          expiresAt: '2099-01-01T00:00:00.000Z',
          consentRecordId: 'consent-1',
        }
        return [
          { meta: { changes: 1 } },
          { meta: { changes: 1 } },
          {
            results: [{
              committed_response: state.envelope.committedResponse,
            }],
          },
        ]
      }

      return statements.map(() => ({ meta: { changes: 1 } }))
    },
  } as unknown as D1Database
}

const input = {
  idempotencyKey: 'register-key-1',
  payloadHash: 'hash-1',
  responseDigest: 'digest-1',
  email: 'user@example.com',
  password: 'A-very-strong-password-123!',
  username: 'user1',
  policy: {
    policyVersion: 'DEV-2026-10-05.1',
    retentionUntil: '2099-01-01T00:00:00.000Z',
    sourceAuthority: 'PRIV-004',
  },
  now: '2026-10-05T00:00:00.000Z',
}

describe('W02 Better Auth registration runtime', () => {
  it('creates the native Better Auth user and completes the consent envelope', async () => {
    const state: { envelope: FakeRow | null; user: FakeRow | null } = {
      envelope: null,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user1',
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
    }
    const db = makeDatabase(state)
    const signUpEmail = vi.fn().mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user1',
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
    })

    const result = await registerWithBetterAuth(
      db,
      { api: { signUpEmail } } as any,
      input,
    )

    expect(result).toEqual({
      userId: 'user-1',
      accountState: 'PENDING_VERIFICATION',
    })
    expect(signUpEmail).toHaveBeenCalledWith({
      body: {
        email: input.email,
        password: input.password,
        name: input.username,
        username: input.username,
      },
    })
  })

  it('recovers when the reservation is not immediately visible through the idempotency-key index', async () => {
    const state: { envelope: FakeRow | null; user: FakeRow | null } = {
      envelope: null,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user1',
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
    }
    const signUpEmail = vi.fn().mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user1',
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
    })

    const result = await registerWithBetterAuth(
      makeDatabase(state, { hideEnvelopeLookupByIdempotencyKey: true }),
      { api: { signUpEmail } } as any,
      input,
    )

    expect(result).toEqual({
      userId: 'user-1',
      accountState: 'PENDING_VERIFICATION',
    })
    expect(signUpEmail).toHaveBeenCalledOnce()
  })
  it('replays a completed registration without invoking Better Auth again', async () => {
    const state: { envelope: FakeRow | null; user: FakeRow | null } = {
      envelope: {
        id: 'env-1',
        payloadHash: 'hash-1',
        state: 'COMPLETED',
        committedResponse: JSON.stringify({
          userId: 'user-1',
          accountState: 'PENDING_VERIFICATION',
        }),
        expiresAt: '2099-01-01T00:00:00.000Z',
        consentRecordId: 'consent-1',
      },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user1',
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion: 1,
      },
    }
    const signUpEmail = vi.fn()

    const result = await registerWithBetterAuth(
      makeDatabase(state),
      { api: { signUpEmail } } as any,
      input,
    )

    expect(result).toEqual({
      userId: 'user-1',
      accountState: 'PENDING_VERIFICATION',
    })
    expect(signUpEmail).not.toHaveBeenCalled()
  })

  it('fails closed when the replay record is not backed by Better Auth', async () => {
    const state: { envelope: FakeRow | null; user: FakeRow | null } = {
      envelope: {
        id: 'env-1',
        payloadHash: 'hash-1',
        state: 'COMPLETED',
        committedResponse: JSON.stringify({
          userId: 'legacy-payload-user-1',
          accountState: 'PENDING_VERIFICATION',
        }),
        expiresAt: '2099-01-01T00:00:00.000Z',
        consentRecordId: 'consent-1',
      },
      user: null,
    }

    await expect(
      registerWithBetterAuth(
        makeDatabase(state),
        { api: { signUpEmail: vi.fn() } } as any,
        input,
      ),
    ).rejects.toBeInstanceOf(RegistrationRuntimeError)
  })
})
