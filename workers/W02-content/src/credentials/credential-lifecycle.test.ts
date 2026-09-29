import { describe, expect, it } from 'vitest'
import { hashCredentialValue, normalizeCredentialValue } from './credential-add.js'
import { removeCredential, replaceCredential } from './credential-lifecycle.js'

const SECRET = 's'.repeat(48)
const NOW = '2026-09-27T07:00:00.000Z'

type Row = {
  id: string
  identity_id: string
  user_id: string
  kind: 'username' | 'email' | 'phone'
  value_hash: string
  normalized_value: string
  active: number
}

function fakeD1(seed: Row[]) {
  const credentials = new Map(seed.map((row) => [row.id, { ...row }]))
  const calls: string[] = []

  const db = {
    calls,
    prepare(sql: string) {
      calls.push(sql)
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (!sql.includes('FROM auth_credentials')) throw new Error('unsupported first() query')
              const removeShape = sql.includes('active_credential_count')
              const argsAsStrings = args.map(String)
              const credentialId = removeShape ? argsAsStrings[1] : argsAsStrings[0]
              const userId = removeShape ? argsAsStrings[2] : argsAsStrings[1]
              const row = [...credentials.values()].find(
                (candidate) => candidate.id === credentialId && candidate.user_id === userId,
              )
              if (!row) return undefined as T | undefined
              if (removeShape) {
                const activeCount = [...credentials.values()].filter(
                  (candidate) => candidate.user_id === userId && candidate.active === 1,
                ).length
                return { ...row, active_credential_count: activeCount } as T
              }
              return row as T
            },
            async run() {
              if (sql.startsWith('UPDATE auth_credentials SET active = 0')) {
                const [, id, identityId, userId] = args as [string, string, string, string]
                const row = credentials.get(id)
                const activeCount = [...credentials.values()].filter(
                  (candidate) => candidate.user_id === userId && candidate.active === 1,
                ).length
                if (!row || row.identity_id !== identityId || row.active !== 1 || activeCount <= 1) {
                  return { meta: { changes: 0 } }
                }
                row.active = 0
                return { meta: { changes: 1 } }
              }

              if (sql.startsWith('UPDATE auth_credentials ')) {
                const [valueHash, normalizedValue, , id, identityId] = args as [
                  string,
                  string,
                  string,
                  string,
                  string,
                ]
                const row = credentials.get(id)
                if (!row || row.identity_id !== identityId || row.active !== 1) {
                  return { meta: { changes: 0 } }
                }
                if (
                  [...credentials.values()].some(
                    (candidate) =>
                      candidate.id !== id &&
                      candidate.kind === row.kind &&
                      candidate.normalized_value === normalizedValue,
                  )
                ) {
                  throw new Error('UNIQUE constraint failed')
                }
                row.value_hash = valueHash
                row.normalized_value = normalizedValue
                return { meta: { changes: 1 } }
              }

              throw new Error('unsupported run() query')
            },
          }
        },
      }
    },
  }

  return db as unknown as D1Database & { calls: string[] }
}

async function seededRow(
  id: string,
  userId: string,
  identityId: string,
  kind: Row['kind'],
  value: string,
  active = 1,
): Promise<Row> {
  const normalized = normalizeCredentialValue(kind, value)
  return {
    id,
    identity_id: identityId,
    user_id: userId,
    kind,
    value_hash: await hashCredentialValue(kind, normalized, SECRET),
    normalized_value: normalized,
    active,
  }
}

describe('AUTH-003 credential lifecycle', () => {
  it('replaces only an owned active credential and returns public projection', async () => {
    const db = fakeD1([
      await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'old@example.invalid'),
      await seededRow('auth3-b', 'user-a', 'identity-a', 'phone', '+14155552671'),
    ])

    const result = await replaceCredential(db, {
      actorUserId: 'user-a',
      credentialId: 'auth3-a',
      value: 'New@Example.invalid',
      idempotencyKey: 'replace-a',
      secret: SECRET,
      now: NOW,
    })

    expect(result).toEqual({ credentialId: 'auth3-a', kind: 'email', active: true })
    expect(Object.keys(result).sort()).toEqual(['active', 'credentialId', 'kind'])
  })

  it('treats replay of the already-authoritative value as idempotent', async () => {
    const row = await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'new@example.invalid')
    const db = fakeD1([row])

    const result = await replaceCredential(db, {
      actorUserId: 'user-a',
      credentialId: 'auth3-a',
      value: 'new@example.invalid',
      idempotencyKey: 'replace-replay',
      secret: SECRET,
      now: NOW,
    })

    expect(result).toEqual({ credentialId: 'auth3-a', kind: 'email', active: true })
    expect(db.calls.filter((sql) => sql.startsWith('UPDATE')).length).toBe(0)
  })

  it('enforces persistence uniqueness and keeps kind immutable', async () => {
    const db = fakeD1([
      await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'old@example.invalid'),
      await seededRow('auth3-b', 'user-a', 'identity-a', 'phone', '+14155552671'),
      await seededRow('auth3-c', 'user-b', 'identity-b', 'email', 'taken@example.invalid'),
    ])

    await expect(
      replaceCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-a',
        value: 'taken@example.invalid',
        idempotencyKey: 'replace-conflict',
        secret: SECRET,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    const updated = await replaceCredential(db, {
      actorUserId: 'user-a',
      credentialId: 'auth3-a',
      value: 'new@example.invalid',
      idempotencyKey: 'replace-success',
      secret: SECRET,
      now: NOW,
    })
    expect(updated.kind).toBe('email')
  })

  it('rejects non-owned and inactive credentials', async () => {
    const db = fakeD1([
      await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'owned@example.invalid'),
      await seededRow('auth3-b', 'user-b', 'identity-b', 'email', 'private@example.invalid'),
      await seededRow('auth3-c', 'user-a', 'identity-a', 'phone', '+14155552671', 0),
    ])

    await expect(
      replaceCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-b',
        value: 'blocked@example.invalid',
        idempotencyKey: 'k1',
        secret: SECRET,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      replaceCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-c',
        value: '+14155552672',
        idempotencyKey: 'k2',
        secret: SECRET,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('prevents removal of the only active credential', async () => {
    const db = fakeD1([
      await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'only@example.invalid'),
    ])

    await expect(
      removeCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-a',
        idempotencyKey: 'remove-only',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('enforces only-active-credential safety in the authoritative update predicate', async () => {
    const rowA = await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'first@example.invalid')
    const rowB = await seededRow('auth3-b', 'user-a', 'identity-a', 'phone', '+14155552671')
    const db = fakeD1([rowA, rowB])

    await removeCredential(db, {
      actorUserId: 'user-a',
      credentialId: 'auth3-a',
      idempotencyKey: 'remove-safe',
      now: NOW,
    })

    const updateSql = db.calls.find((sql) => sql.startsWith('UPDATE auth_credentials SET active = 0'))
    expect(updateSql).toContain('SELECT COUNT(*)')
    expect(updateSql).toContain('active_i.user_id = ?')
  })

  it('removes an owned credential and makes replay harmless', async () => {
    const rowA = await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'first@example.invalid')
    const rowB = await seededRow('auth3-b', 'user-a', 'identity-a', 'phone', '+14155552671')
    const db = fakeD1([rowA, rowB])

    await removeCredential(db, {
      actorUserId: 'user-a',
      credentialId: 'auth3-a',
      idempotencyKey: 'remove-a',
      now: NOW,
    })
    await removeCredential(db, {
      actorUserId: 'user-a',
      credentialId: 'auth3-a',
      idempotencyKey: 'remove-a',
      now: NOW,
    })

    expect(db.calls.filter((sql) => sql.startsWith('UPDATE auth_credentials SET active')).length).toBe(1)
  })

  it('does not disclose another account through removal', async () => {
    const db = fakeD1([
      await seededRow('auth3-a', 'user-a', 'identity-a', 'email', 'first@example.invalid'),
      await seededRow('auth3-b', 'user-b', 'identity-b', 'phone', '+14155552671'),
    ])

    await expect(
      removeCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-b',
        idempotencyKey: 'remove-cross',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('fails closed when credential ownership lookup is unavailable', async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                throw new Error('D1 network detail must not escape')
              },
            }
          },
        }
      },
    } as unknown as D1Database

    await expect(
      replaceCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-a',
        value: 'new@example.invalid',
        idempotencyKey: 'replace-unavailable',
        secret: SECRET,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    await expect(
      replaceCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-a',
        value: 'new@example.invalid',
        idempotencyKey: 'replace-unavailable-2',
        secret: SECRET,
        now: NOW,
      }),
    ).rejects.toThrow('credential service unavailable')
  })

  it('fails closed when credential removal lookup is unavailable', async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                throw new Error('protected D1 failure')
              },
            }
          },
        }
      },
    } as unknown as D1Database

    await expect(
      removeCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-a',
        idempotencyKey: 'remove-unavailable',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    await expect(
      removeCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-a',
        idempotencyKey: 'remove-unavailable-2',
        now: NOW,
      }),
    ).rejects.toThrow('credential service unavailable')
  })


  it('maps malformed input to the lifecycle contract', async () => {
    const db = fakeD1([])
    await expect(
      removeCredential(db, {
        actorUserId: '',
        credentialId: 'auth3-a',
        idempotencyKey: 'k',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    await expect(
      replaceCredential(db, {
        actorUserId: 'user-a',
        credentialId: 'auth3-a',
        value: 'x',
        idempotencyKey: 'k',
        secret: 'short',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
