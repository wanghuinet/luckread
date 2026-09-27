import { describe, expect, it } from 'vitest'
import {
  addCredential,
  deriveCredentialId,
  hashCredentialValue,
  normalizeCredentialValue,
} from './credential-add.js'

const SECRET = 's'.repeat(48)
const NOW = '2026-09-27T06:00:00.000Z'

type Row = {
  id: string
  identity_id: string
  kind: 'username' | 'email' | 'phone'
  value_hash: string
  normalized_value: string
  active: number
}

function fakeD1() {
  const identities = new Map<string, { id: string; user_id: string }>()
  const credentials = new Map<string, Row>()

  const db = {
    seedIdentity(id: string, userId: string) {
      identities.set(id, { id, user_id: userId })
    },
    credentialRows() {
      return [...credentials.values()]
    },
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM auth_identities')) {
                const userId = String(args[0])
                const identity = [...identities.values()].find((row) => row.user_id === userId)
                return (identity ? { id: identity.id } : undefined) as T | undefined
              }

              if (sql.includes('FROM auth_credentials')) {
                const id = String(args[0])
                return credentials.get(id) as T | undefined
              }

              throw new Error('unsupported first() query')
            },
            async run() {
              if (sql.includes('INSERT INTO auth_credentials')) {
                const [id, identityId, kind, valueHash, normalizedValue, createdAt, updatedAt] = args as [
                  string,
                  string,
                  Row['kind'],
                  string,
                  string,
                  string,
                  string,
                ]

                if ([...credentials.values()].some((row) =>
                  row.kind === kind && row.normalized_value === normalizedValue
                )) {
                  throw new Error('UNIQUE constraint failed')
                }

                if (credentials.has(id)) {
                  throw new Error('UNIQUE constraint failed')
                }

                if ([...credentials.values()].some((row) => row.value_hash === valueHash)) {
                  throw new Error('UNIQUE constraint failed')
                }

                credentials.set(id, {
                  id,
                  identity_id: identityId,
                  kind,
                  value_hash: valueHash,
                  normalized_value: normalizedValue,
                  active: 1,
                })

                return { meta: { changes: 1 } }
              }

              throw new Error('unsupported run() query')
            },
          }
        },
      }
    },
  }

  return db as unknown as D1Database & {
    seedIdentity(id: string, userId: string): void
    credentialRows(): Row[]
  }
}

describe('AUTH-003 credential add', () => {
  it('normalizes username/email and validates phone without provider-specific rewriting', () => {
    expect(normalizeCredentialValue('username', '  Cafe\\u0301User  ')).toBe('caféuser')
    expect(normalizeCredentialValue('email', '  Test.Example@Invalid.Local ')).toBe(
      'test.example@invalid.local',
    )
    expect(normalizeCredentialValue('phone', '+14155552671')).toBe('+14155552671')
    expect(() => normalizeCredentialValue('phone', '4155552671')).toThrow(/invalid/)
  })

  it('binds the credential hash to kind and secret rather than exposing raw material', async () => {
    const emailHash = await hashCredentialValue('email', 'same-value', SECRET)
    const usernameHash = await hashCredentialValue('username', 'same-value', SECRET)
    const otherSecretHash = await hashCredentialValue('email', 'same-value', 't'.repeat(48))

    expect(emailHash).toMatch(/^[0-9a-f]{64}$/)
    expect(emailHash).not.toContain('same-value')
    expect(emailHash).not.toBe(usernameHash)
    expect(emailHash).not.toBe(otherSecretHash)
  })

  it('adds one credential and returns only the contracted public projection', async () => {
    const db = fakeD1()
    db.seedIdentity('identity-a', 'user-a')

    const result = await addCredential(db, {
      actorUserId: 'user-a',
      targetUserId: 'user-a',
      kind: 'email',
      value: ' Test.Example@Invalid.Local ',
      idempotencyKey: 'key-a',
      secret: SECRET,
      now: NOW,
    })

    expect(result).toEqual({
      credentialId: expect.stringMatching(/^auth3_[0-9a-f]{64}$/),
      kind: 'email',
      active: true,
    })
    expect(Object.keys(result).sort()).toEqual(['active', 'credentialId', 'kind'])
    expect(db.credentialRows()).toHaveLength(1)
    expect(db.credentialRows()[0]?.normalized_value).toBe('test.example@invalid.local')
  })

  it('replays the same idempotency key without creating a second credential', async () => {
    const db = fakeD1()
    db.seedIdentity('identity-a', 'user-a')

    const input = {
      actorUserId: 'user-a',
      targetUserId: 'user-a',
      kind: 'email' as const,
      value: 'Test@example.invalid',
      idempotencyKey: 'same-key',
      secret: SECRET,
      now: NOW,
    }

    const first = await addCredential(db, input)
    const second = await addCredential(db, input)

    expect(second).toEqual(first)
    expect(db.credentialRows()).toHaveLength(1)
  })

  it('rejects idempotency-key reuse for a different credential request', async () => {
    const db = fakeD1()
    db.seedIdentity('identity-a', 'user-a')

    await addCredential(db, {
      actorUserId: 'user-a',
      targetUserId: 'user-a',
      kind: 'email',
      value: 'first@example.invalid',
      idempotencyKey: 'same-key',
      secret: SECRET,
      now: NOW,
    })

    await expect(
      addCredential(db, {
        actorUserId: 'user-a',
        targetUserId: 'user-a',
        kind: 'email',
        value: 'second@example.invalid',
        idempotencyKey: 'same-key',
        secret: SECRET,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(db.credentialRows()).toHaveLength(1)
  })

  it('denies cross-account management before any persistence read or write', async () => {
    const db = fakeD1()
    db.seedIdentity('identity-a', 'user-a')
    db.seedIdentity('identity-b', 'user-b')

    await expect(
      addCredential(db, {
        actorUserId: 'user-a',
        targetUserId: 'user-b',
        kind: 'email',
        value: 'protected@example.invalid',
        idempotencyKey: 'cross-account',
        secret: SECRET,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })

    expect(db.credentialRows()).toHaveLength(0)
  })

  it('enforces the persistence uniqueness boundary across identities', async () => {
    const db = fakeD1()
    db.seedIdentity('identity-a', 'user-a')
    db.seedIdentity('identity-b', 'user-b')

    await addCredential(db, {
      actorUserId: 'user-a',
      targetUserId: 'user-a',
      kind: 'email',
      value: 'Same@Example.invalid',
      idempotencyKey: 'key-a',
      secret: SECRET,
      now: NOW,
    })

    await expect(
      addCredential(db, {
        actorUserId: 'user-b',
        targetUserId: 'user-b',
        kind: 'email',
        value: ' same@example.invalid ',
        idempotencyKey: 'key-b',
        secret: SECRET,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(db.credentialRows()).toHaveLength(1)
  })

  it('derives stable opaque credential ids from the self scope and idempotency key', async () => {
    const first = await deriveCredentialId('user-a', 'key-a')
    const second = await deriveCredentialId('user-a', 'key-a')
    const otherUser = await deriveCredentialId('user-b', 'key-a')

    expect(first).toBe(second)
    expect(first).not.toBe(otherUser)
    expect(first).toMatch(/^auth3_[0-9a-f]{64}$/)
  })
})
