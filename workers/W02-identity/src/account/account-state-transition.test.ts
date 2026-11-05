import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  activateEmailVerifiedAccount,
  applyAccountStateTransition,
  authorizeAccountStateTransition,
  type AccountStateTransitionInput,
} from './account-state-transition.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

function input(overrides: Partial<AccountStateTransitionInput> = {}): AccountStateTransitionInput {
  return {
    userId: '42',
    to: 'RESTRICTED',
    reason: 'moderation action',
    expectedVersion: 7,
    actor: { id: 'operator-1', type: 'operator' },
    permission: 'user.restrict.limited',
    ...overrides,
  }
}

function fakeDb(
  initial: { state: string; version: number; deletionRequestedAt?: string | null; deletedAt?: string | null },
  options: { failBatch?: boolean; missingUser?: boolean; forceJournalConflict?: boolean; roleAssignmentChanges?: number } = {},
) {
  const row = { ...initial }
  let batchCalls = 0
  let lastJournal: Record<string, unknown> | null = null
  let sessionRevocation: unknown[] | null = null
  let grantedRole: { sql: string; args: unknown[] } | null = null

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async <T>() => {
              if (options.missingUser) return null
              const snapshot = { accountState: row.state, accountStateVersion: row.version } as Record<string, unknown>
              if (sql.includes('deletion_requested_at')) {
                snapshot.deletionRequestedAt = row.deletionRequestedAt ?? null
                snapshot.deletedAt = row.deletedAt ?? null
              }
              if (options.forceJournalConflict) {
                row.state = 'RESTRICTED'
                row.version += 1
              }
              return snapshot as T
            },
            sql,
            args,
          }
        },
      }
    },
    async batch(statements: Array<{ sql: string; args: unknown[] }>) {
      batchCalls += 1
      if (options.failBatch) {
        throw new Error('D1 journal constraint failure')
      }

      const update = statements[0]
      const journal = statements[1]
      const updateArgs = update.args
      const nextState = String(updateArgs[0])
      const expectedState = String(updateArgs[updateArgs.length - 2])
      const expectedVersion = Number(updateArgs[updateArgs.length - 1])

      if (row.state !== expectedState || row.version !== expectedVersion) {
        throw new Error('UNIQUE constraint failed: auth_013_publication_journal.resource_id, event_type, source_version')
      }

      row.state = nextState
      row.version += 1

      const setClause = update.sql.split(' WHERE ')[0]
      const lifecycleSetClause = setClause.slice(setClause.indexOf('updated_at = ?') + 'updated_at = ?'.length)
      let lifecycleBindingIndex = 2
      for (const assignment of lifecycleSetClause.split(',').map((part) => part.trim()).filter(Boolean)) {
        if (assignment === 'deletion_requested_at = ?') {
          row.deletionRequestedAt = String(updateArgs[lifecycleBindingIndex++])
        } else if (assignment === 'deleted_at = ?') {
          row.deletedAt = String(updateArgs[lifecycleBindingIndex++])
        } else if (assignment === 'deletion_requested_at = NULL') {
          row.deletionRequestedAt = null
        } else if (assignment === 'deleted_at = NULL') {
          row.deletedAt = null
        }
      }

      for (const statement of statements) {
        if (statement.sql === 'DELETE FROM "session" WHERE user_id = ?') {
          sessionRevocation = statement.args
        }
        if (statement.sql.includes('INSERT INTO role_assignments')) {
          grantedRole = { sql: statement.sql, args: statement.args }
        }
      }

      const journalArgs = journal.args as unknown[]
      lastJournal = {
        journalId: journalArgs[0],
        eventId: journalArgs[1],
        eventType: journalArgs[2],
        schemaVersion: journalArgs[3],
        resourceId: journalArgs[4],
        sourceVersion: journalArgs[5],
        payload: journalArgs[6],
        status: journalArgs[7],
        attempt: journalArgs[8],
        nextAttemptAt: journalArgs[9],
        createdAt: journalArgs[10],
        publishedAt: journalArgs[11],
        lastErrorCode: journalArgs[12],
      }

      return statements.map((statement, index) => ({
        meta: {
          changes: statement.sql === 'DELETE FROM "session" WHERE user_id = ?'
            ? 0
            : statement.sql.includes('INSERT INTO role_assignments')
              ? (options.roleAssignmentChanges ?? 1)
              : index < 2 ? 1 : 1,
        },
      }))
    },
  }

  return {
    db: db as unknown as D1Database,
    row,
    batchCalls: () => batchCalls,
    journal: () => lastJournal,
    sessionRevocation: () => sessionRevocation,
    grantedRole: () => grantedRole,
  }
}

describe('AUTH-015 lifecycle-window persistence migration', () => {
  it('adds only nullable timestamp columns to the existing Better Auth user table', () => {
    const migration = readFileSync(
      new URL('../../migrations/0009_auth_015_lifecycle_windows.sql', import.meta.url),
      'utf8',
    )
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE "user" (
          id TEXT PRIMARY KEY NOT NULL,
          account_state TEXT NOT NULL,
          account_state_version INTEGER NOT NULL
        );
        INSERT INTO "user" (id, account_state, account_state_version)
        VALUES ('existing-active-user', 'ACTIVE', 1);
      `)
      db.exec(migration)

      const columns = db.prepare('PRAGMA table_info("user")').all() as Array<{
        name: string
        type: string
        notnull: number
        dflt_value: string | null
      }>
      for (const name of ['deletion_requested_at', 'deleted_at']) {
        const column = columns.find((entry) => entry.name === name)
        expect(column).toMatchObject({ name, type: 'TEXT', notnull: 0, dflt_value: null })
      }
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{name:string}>
      expect(tables.map((entry) => entry.name)).toEqual(['user'])
      expect(db.prepare('SELECT account_state, account_state_version, deletion_requested_at, deleted_at FROM "user"').get())
        .toEqual({
          account_state: 'ACTIVE',
          account_state_version: 1,
          deletion_requested_at: null,
          deleted_at: null,
        })
    } finally {
      db.close()
    }
  })

  it('fails closed when an account is already in a deletion state without timestamp provenance', () => {
    const migration = readFileSync(
      new URL('../../migrations/0009_auth_015_lifecycle_windows.sql', import.meta.url),
      'utf8',
    )
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE "user" (
          id TEXT PRIMARY KEY NOT NULL,
          account_state TEXT NOT NULL,
          account_state_version INTEGER NOT NULL
        );
        INSERT INTO "user" (id, account_state, account_state_version)
        VALUES ('existing-deleted-user', 'DELETED', 3);
      `)
      expect(() => db.exec(migration)).toThrow()
      const columns = db.prepare('PRAGMA table_info("user")').all() as Array<{name:string}>
      expect(columns.some((entry) => entry.name === 'deletion_requested_at')).toBe(false)
      expect(columns.some((entry) => entry.name === 'deleted_at')).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('AUTH-013 Better Auth persistence boundary', () => {
  it('uses the native Better Auth user and session tables', () => {
    const source = readFileSync(new URL('./account-state-transition.ts', import.meta.url), 'utf8')
    expect(source).toContain('FROM "user"')
    expect(source).toContain('UPDATE "user"')
    expect(source).toContain('DELETE FROM "session" WHERE user_id = ?')
    expect(source).not.toContain('auth_session_state')
  })
})

describe('AUTH-013 account-state transition kernel', () => {
  it('atomically advances Account State and creates the durable publication journal', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })
    const result = await applyAccountStateTransition(fake.db, input())

    expect(result.from).toBe('ACTIVE')
    expect(result.to).toBe('RESTRICTED')
    expect(result.accountStateVersion).toBe(8)
    expect(result.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.journalId).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.row).toEqual({ state: 'RESTRICTED', version: 8 })
    expect(fake.batchCalls()).toBe(1)

    const journal = fake.journal()
    expect(journal?.eventType).toBe('identity.account_state_changed')
    expect(journal?.schemaVersion).toBe('1.0')
    expect(journal?.resourceId).toBe('42')
    expect(journal?.sourceVersion).toBe(8)
    expect(journal?.status).toBe('PENDING')
    expect(journal?.attempt).toBe(1)

    const event = JSON.parse(String(journal?.payload))
    expect(event).toMatchObject({
      eventId: journal?.eventId,
      eventType: 'identity.account_state_changed',
      schemaVersion: '1.0',
      producer: 'W02',
      resourceType: 'User',
      resourceId: '42',
      occurredAt: '2026-09-24T12:00:00.000Z',
      publishedAt: '2026-09-24T12:00:00.000Z',
      correlationId: expect.any(String),
      causationId: expect.any(String),
      idempotencyKey: 'auth013-42-7',
      attempt: 1,
      sourceVersion: 8,
      actor: {
        actorId: 'operator-1',
        actorType: 'user',
        operationalRole: 'PLATFORM_OPERATOR',
      },
      before: {
        accountState: 'ACTIVE',
        accountStateVersion: 7,
      },
      after: {
        accountState: 'RESTRICTED',
        accountStateVersion: 8,
      },
      reason: 'moderation action',
    })
  })

  it('rejects a stale If-Match version without entering the write batch', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 8 })

    await expect(applyAccountStateTransition(fake.db, input({ expectedVersion: 7 }))).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 8 })
    expect(fake.batchCalls()).toBe(0)
  })

  it('rolls back the in-memory state when the durable journal write fails', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 }, { failBatch: true })

    await expect(applyAccountStateTransition(fake.db, input())).rejects.toMatchObject({
      code: 'JOURNAL_PERSISTENCE_FAILED',
    })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 7 })
    expect(fake.batchCalls()).toBe(1)
    expect(fake.journal()).toBeNull()
  })

  it('requires the canonical permission for operator enforcement', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(
      applyAccountStateTransition(fake.db, input({ permission: 'user.freeze' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(fake.batchCalls()).toBe(0)
  })

  it('requires L7 approval for ACTIVE -> BANNED', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({
          to: 'BANNED',
          permission: 'user.ban',
          actor: { id: 'admin-1', type: 'admin' },
          approvalLevel: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'BANNED',
        permission: 'user.ban',
        actor: { id: 'admin-1', type: 'admin' },
        approvalLevel: 'L7',
      }),
    )
    expect(result.from).toBe('ACTIVE')
    expect(result.to).toBe('BANNED')
    expect(result.accountStateVersion).toBe(8)
  })

  it('fails closed when a required lifecycle precondition is not proven', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({
          to: 'ACTIVE',
          actor: { id: '42', type: 'user' },
          permission: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    expect(fake.batchCalls()).toBe(0)
  })

  it('accepts user-owned UNREGISTERED -> PENDING_VERIFICATION without permission', async () => {
    const fake = fakeDb({ state: 'UNREGISTERED', version: 1 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        userId: '42',
        to: 'PENDING_VERIFICATION',
        expectedVersion: 1,
        actor: { id: '42', type: 'user' },
        permission: null,
      }),
    )

    expect(result.accountStateVersion).toBe(2)
    expect(fake.row).toEqual({ state: 'PENDING_VERIFICATION', version: 2 })
  })

  it('keeps verification-timeout deletion fail-closed until its trusted evaluator is implemented', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 2 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({
          to: 'DELETED',
          expectedVersion: 2,
          actor: { id: 'job:account-lifecycle', type: 'job' },
          permission: 'system.job',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    expect(fake.batchCalls()).toBe(0)
    expect(fake.row).toEqual({ state: 'PENDING_VERIFICATION', version: 2 })
  })

  it('atomically revokes active session extensions when a token-invalidating state is entered', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'SUSPENDED',
        actor: { id: 'admin-1', type: 'admin' },
        permission: 'user.suspend',
      }),
    )

    expect(result.accountStateVersion).toBe(8)
    expect(fake.sessionRevocation()).toEqual(['42'])
    expect(fake.batchCalls()).toBe(1)
  })

  it('does not add session revocation for a state whose contract keeps tokens valid', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'FROZEN',
        permission: 'user.freeze',
      }),
    )

    expect(result.accountStateVersion).toBe(8)
    expect(fake.sessionRevocation()).toBeNull()
  })

  it('accepts BANNED -> RESTORED only with admin actor, user.restore permission and L7 approval', async () => {
    const fake = fakeDb({ state: 'BANNED', version: 4 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'RESTORED',
        expectedVersion: 4,
        actor: { id: 'admin-1', type: 'admin' },
        permission: 'user.restore',
        approvalLevel: 'L7',
      }),
    )

    expect(result.accountStateVersion).toBe(5)
  })

  it('rejects a concurrent compare-and-set race through the journal uniqueness boundary', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 }, { forceJournalConflict: true })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({ expectedVersion: 7 }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(fake.row).toEqual({ state: 'RESTRICTED', version: 8 })
    expect(fake.batchCalls()).toBe(1)
  })

  it('rejects an operator transition when the actor type is not authorized', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({ actor: { id: 'admin-1', type: 'admin' } }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(fake.batchCalls()).toBe(0)
  })

  it('rejects missing users without attempting a write', async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => null,
            }
          },
        }
      },
    } as unknown as D1Database

    await expect(applyAccountStateTransition(db, input())).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('propagates a supplied correlation and causation id', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await applyAccountStateTransition(
      fake.db,
      input({
        correlationId: 'corr-123456789012',
        causationId: 'cause-123456789012',
      }),
    )

    const event = JSON.parse(String(fake.journal()?.payload))
    expect(event.correlationId).toBe('corr-123456789012')
    expect(event.causationId).toBe('cause-123456789012')
  })
})


function authorizationDb(
  state: string,
  roles: Array<{ roleId: string; scopeType: string }> = [],
  preparedSql: string[] = [],
  preparedBindings: Array<{ sql: string; args: unknown[] }> = [],
) {
  return {
    prepare(sql: string) {
      preparedSql.push(sql)
      return {
        bind(...args: unknown[]) {
          preparedBindings.push({ sql, args })
          return {
            first: async <T>() => {
              if (sql.includes('FROM "user"')) {
                return { accountState: state } as T
              }
              return null
            },
            all: async <T>() => ({ results: roles } as T),
          }
        },
      }
    },
  } as unknown as D1Database
}

describe('AUTH-013 trusted-principal authorization boundary', () => {
  it('bounds role reads and prioritizes the highest canonical layer inside the row cap', async () => {
    const preparedSql: string[] = []
    const preparedBindings: Array<{ sql: string; args: unknown[] }> = []
    await authorizeAccountStateTransition(
      authorizationDb(
        'ACTIVE',
        [{ roleId: 'operator', scopeType: 'global' }],
        preparedSql,
        preparedBindings,
      ),
      { subjectId: 'operator-1', targetUserId: '42', to: 'RESTRICTED' },
    )

    const roleQuery = preparedSql.find((sql) => sql.includes('FROM role_assignments'))
    expect(roleQuery).toContain('SELECT DISTINCT role_id AS roleId')
    expect(roleQuery).toContain("scope_type = 'global'")
    expect(roleQuery).toContain('ORDER BY CASE role_id WHEN ? THEN ?')
    expect(roleQuery).toContain('LIMIT 62')

    const roleBindings = preparedBindings.find((query) => query.sql.includes('FROM role_assignments'))
    expect(roleBindings?.args.slice(3, 5)).toEqual(['super_admin', 8])
  })

  it('derives operator permission and actor class from canonical role layer', async () => {
    const result = await authorizeAccountStateTransition(
      authorizationDb('ACTIVE', [{ roleId: 'operator', scopeType: 'global' }]),
      { subjectId: 'operator-1', targetUserId: '42', to: 'RESTRICTED' },
    )

    expect(result).toEqual({
      actor: { id: 'operator-1', type: 'operator' },
      permission: 'user.restrict.limited',
      approvalLevel: null,
    })
  })

  it('fails closed when a lower layer cannot authorize a privileged transition', async () => {
    await expect(
      authorizeAccountStateTransition(
        authorizationDb('ACTIVE', [{ roleId: 'mcn_admin', scopeType: 'global' }]),
        { subjectId: 'operator-1', targetUserId: '42', to: 'RESTRICTED' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('derives L7 approval for ban instead of trusting client input', async () => {
    const result = await authorizeAccountStateTransition(
      authorizationDb('ACTIVE', [{ roleId: 'admin', scopeType: 'global' }]),
      { subjectId: 'admin-1', targetUserId: '42', to: 'BANNED' },
    )

    expect(result.actor).toEqual({ id: 'admin-1', type: 'admin' })
    expect(result.permission).toBe('user.ban')
    expect(result.approvalLevel).toBe('L7')
  })

  it('authorizes self reactivation through the explicit L1 user role grant', async () => {
    const result = await authorizeAccountStateTransition(
      authorizationDb('DELETED', [{ roleId: 'user', scopeType: 'global' }]),
      {
        subjectId: '42',
        targetUserId: '42',
        to: 'REACTIVATED',
      },
    )

    expect(result).toEqual({
      actor: { id: '42', type: 'user' },
      permission: 'user.reactivate',
      approvalLevel: null,
    })
  })

  it('does not infer self reactivation permission from layer membership alone', async () => {
    await expect(
      authorizeAccountStateTransition(
        authorizationDb('DELETED', [{ roleId: 'mcn_admin', scopeType: 'global' }]),
        {
          subjectId: '42',
          targetUserId: '42',
          to: 'REACTIVATED',
          },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('requires the authenticated subject to be the target for permissionful self transitions', async () => {
    await expect(
      authorizeAccountStateTransition(
        authorizationDb('DELETED', [{ roleId: 'user', scopeType: 'global' }]),
        {
          subjectId: 'different-user',
          targetUserId: '42',
          to: 'REACTIVATED',
          },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('requires a self principal for permissionless user-owned transitions', async () => {
    await expect(
      authorizeAccountStateTransition(
        authorizationDb('ACTIVE'),
        { subjectId: 'other-user', targetUserId: '42', to: 'DELETION_REQUESTED' },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('AUTH-015 trusted lifecycle time-window evaluation', () => {
  const now = '2026-09-24T12:00:00.000Z'

  it('starts the 15-day cooling-off clock from W02 server time when deletion is requested', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7, deletedAt: '2026-01-01T00:00:00.000Z' })
    await applyAccountStateTransition(
      fake.db,
      input({
        to: 'DELETION_REQUESTED',
        actor: { id: '42', type: 'user' },
        permission: null,
      }),
    )

    expect(fake.row).toMatchObject({
      state: 'DELETION_REQUESTED',
      version: 8,
      deletionRequestedAt: now,
      deletedAt: null,
    })
  })

  it('allows cancellation one millisecond before the 15-day cooling-off deadline', async () => {
    const fake = fakeDb({
      state: 'DELETION_REQUESTED',
      version: 7,
      deletionRequestedAt: '2026-09-09T12:00:00.001Z',
    })
    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'ACTIVE',
        actor: { id: '42', type: 'user' },
        permission: null,
      }),
    )

    expect(result.to).toBe('ACTIVE')
    expect(fake.row).toMatchObject({ state: 'ACTIVE', deletionRequestedAt: null, deletedAt: null })
  })

  it('rejects cancellation exactly at the 15-day deadline', async () => {
    const fake = fakeDb({
      state: 'DELETION_PENDING',
      version: 7,
      deletionRequestedAt: '2026-09-09T12:00:00.000Z',
    })
    await expect(
      applyAccountStateTransition(
        fake.db,
        input({
          to: 'ACTIVE',
          actor: { id: '42', type: 'user' },
          permission: null,
          }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    expect(fake.batchCalls()).toBe(0)
    expect(fake.row.state).toBe('DELETION_PENDING')
  })

  it('requires the 15-day cooling-off period to have elapsed before DELETION_PENDING -> DELETED', async () => {
    const early = fakeDb({
      state: 'DELETION_PENDING',
      version: 7,
      deletionRequestedAt: '2026-09-09T12:00:00.001Z',
    })
    await expect(
      applyAccountStateTransition(
        early.db,
        input({
          to: 'DELETED',
          actor: { id: 'job:account-lifecycle', type: 'job' },
          permission: 'system.job',
          }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(early.batchCalls()).toBe(0)

    const elapsed = fakeDb({
      state: 'DELETION_PENDING',
      version: 7,
      deletionRequestedAt: '2026-09-09T12:00:00.000Z',
    })
    await applyAccountStateTransition(
      elapsed.db,
      input({
        to: 'DELETED',
        actor: { id: 'job:account-lifecycle', type: 'job' },
        permission: 'system.job',
      }),
    )
    expect(elapsed.row).toMatchObject({ state: 'DELETED', deletedAt: now })
  })

  it('allows reactivation one millisecond before the 30-day window closes', async () => {
    const fake = fakeDb({
      state: 'DELETED',
      version: 7,
      deletionRequestedAt: '2026-09-01T12:00:00.000Z',
      deletedAt: '2026-08-25T12:00:00.001Z',
    })
    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'REACTIVATED',
        actor: { id: '42', type: 'user' },
        permission: 'user.reactivate',
      }),
    )

    expect(result.to).toBe('REACTIVATED')
    expect(fake.row.deletedAt).toBe('2026-08-25T12:00:00.001Z')
  })

  it('rejects reactivation exactly at the 30-day deadline and fails closed without deleted_at', async () => {
    const exact = fakeDb({
      state: 'DELETED',
      version: 7,
      deletedAt: '2026-08-25T12:00:00.000Z',
    })
    await expect(
      applyAccountStateTransition(
        exact.db,
        input({
          to: 'REACTIVATED',
          actor: { id: '42', type: 'user' },
          permission: 'user.reactivate',
          }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    const missing = fakeDb({ state: 'DELETED', version: 7 })
    await expect(
      applyAccountStateTransition(
        missing.db,
        input({
          to: 'REACTIVATED',
          actor: { id: '42', type: 'user' },
          permission: 'user.reactivate',
          }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(exact.batchCalls()).toBe(0)
    expect(missing.batchCalls()).toBe(0)
  })

  it('rejects future or malformed lifecycle timestamps rather than trusting them', async () => {
    for (const timestamp of ['not-a-date', '2026-09-24T12:00:00.001Z']) {
      const fake = fakeDb({
        state: 'DELETION_REQUESTED',
        version: 7,
        deletionRequestedAt: timestamp,
      })
      await expect(
        applyAccountStateTransition(
          fake.db,
          input({
            to: 'ACTIVE',
            actor: { id: '42', type: 'user' },
            permission: null,
              }),
        ),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
      expect(fake.batchCalls()).toBe(0)
    }
  })
})



type CanonicalTransition = {
  from: AccountStateTransitionInput['to']
  to: AccountStateTransitionInput['to']
  actor: 'user' | 'operator' | 'admin' | 'system'
  permission: string | null
  precondition?: string
  requiresApproval?: boolean | string
}

const canonicalAccountTransitions = JSON.parse(
  readFileSync(new URL('../../../../contracts/state-machines/account.json', import.meta.url), 'utf8'),
) as {
  'x-transitions': CanonicalTransition[]
}

describe('AUTH-013 canonical state-machine coverage', () => {
  it('executes every transition declared by the canonical account state machine', async () => {
    expect(canonicalAccountTransitions['x-transitions']).toHaveLength(26)

    let executed = 0
    for (const transition of canonicalAccountTransitions['x-transitions']) {
      if (transition.precondition === 'phone_or_email_verified' || transition.precondition === 'verification_timeout') {
        continue
      }

      const actorType = transition.actor === 'system' ? 'job' : transition.actor
      const actorId = transition.actor === 'user'
        ? '42'
        : actorType === 'operator'
          ? 'operator-1'
          : actorType === 'admin'
            ? 'admin-1'
            : 'job:account-lifecycle'

      const fake = fakeDb({
        state: transition.from,
        version: 7,
        ...(transition.precondition === 'within_cooling_off'
          ? { deletionRequestedAt: '2026-09-20T12:00:00.000Z' }
          : {}),
        ...(transition.precondition === 'cooling_off_elapsed'
          ? { deletionRequestedAt: '2026-09-01T12:00:00.000Z' }
          : {}),
        ...(transition.precondition === 'within_reactivation_window'
          ? { deletedAt: '2026-09-20T12:00:00.000Z' }
          : {}),
      })

      const result = await applyAccountStateTransition(
        fake.db,
        input({
          to: transition.to,
          actor: { id: actorId, type: actorType },
          permission: transition.permission,
          approvalLevel: transition.requiresApproval
            ? transition.requiresApproval === true
              ? 'L7'
              : transition.requiresApproval
            : null,
        }),
      )

      expect(result.from).toBe(transition.from)
      expect(result.to).toBe(transition.to)
      expect(result.accountStateVersion).toBe(8)
      expect(fake.row).toEqual({ state: transition.to, version: 8 })
      expect(fake.batchCalls()).toBe(1)

      const journal = fake.journal()
      expect(journal?.eventType).toBe('identity.account_state_changed')
      expect(journal?.sourceVersion).toBe(8)

      const expectedSessionRevocation = new Set([
        'SUSPENDED',
        'BANNED',
        'DELETION_PENDING',
        'DELETED',
      ]).has(transition.to)

      expect(fake.sessionRevocation() !== null).toBe(expectedSessionRevocation)
      executed += 1
    }
    expect(executed).toBe(24)
  })

  it('rejects the canonical forbidden direct transitions', async () => {
    const forbidden: Array<{
      from: string
      to: AccountStateTransitionInput['to']
      permission: string | null
      actor: AccountStateTransitionInput['actor']
    }> = [
      {
        from: 'DELETED',
        to: 'ACTIVE',
        permission: null,
        actor: { id: '42', type: 'user' },
      },
      {
        from: 'BANNED',
        to: 'ACTIVE',
        permission: 'user.reinstate',
        actor: { id: 'admin-1', type: 'admin' },
      },
      {
        from: 'ACTIVE',
        to: 'UNREGISTERED',
        permission: null,
        actor: { id: '42', type: 'user' },
      },
    ]

    for (const transition of forbidden) {
      const fake = fakeDb({ state: transition.from, version: 7 })
      await expect(
        applyAccountStateTransition(
          fake.db,
          input({
            to: transition.to,
            actor: transition.actor,
            permission: transition.permission,
              }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' })

      expect(fake.batchCalls()).toBe(0)
      expect(fake.row).toEqual({ state: transition.from, version: 7 })
    }
  })
})


describe('AUTH-013 verified-email account activation', () => {
  it('atomically activates a pending account and grants the canonical L2 role', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 1 })

    await expect(activateEmailVerifiedAccount(fake.db, '42', '2026-10-06T20:00:00.000Z'))
      .resolves.toEqual({
        activated: true,
        accountState: 'ACTIVE',
        accountStateVersion: 2,
      })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 2 })
    expect(fake.batchCalls()).toBe(1)
    expect(fake.grantedRole()).toMatchObject({
      sql: expect.stringContaining('INSERT INTO role_assignments'),
      args: [
        'verified-user-42',
        '42',
        '2026-10-06T20:00:00.000Z',
        '2026-10-06T20:00:00.000Z',
        '2026-10-06T20:00:00.000Z',
      ],
    })
    expect(fake.journal()).toMatchObject({
      eventType: 'identity.account_state_changed',
      resourceId: '42',
      sourceVersion: 2,
      status: 'PENDING',
    })
  })

  it('accepts trigger-inflated D1 change metadata for verified-role materialization', async () => {
    const fake = fakeDb(
      { state: 'PENDING_VERIFICATION', version: 1 },
      { roleAssignmentChanges: 2 },
    )

    await expect(activateEmailVerifiedAccount(fake.db, '42', '2026-10-06T20:00:00.000Z'))
      .resolves.toEqual({
        activated: true,
        accountState: 'ACTIVE',
        accountStateVersion: 2,
      })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 2 })
    expect(fake.batchCalls()).toBe(1)
    expect(fake.grantedRole()).toMatchObject({
      sql: expect.stringContaining('INSERT INTO role_assignments'),
      args: ['verified-user-42', '42', '2026-10-06T20:00:00.000Z', '2026-10-06T20:00:00.000Z', '2026-10-06T20:00:00.000Z'],
    })
    expect(fake.journal()).toMatchObject({
      eventType: 'identity.account_state_changed',
      resourceId: '42',
      sourceVersion: 2,
      status: 'PENDING',
    })
  })

  it('does not repeat state or role writes for an already-active account', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 2 })

    await expect(activateEmailVerifiedAccount(fake.db, '42', '2026-10-06T20:00:00.000Z'))
      .resolves.toEqual({
        activated: false,
        accountState: 'ACTIVE',
        accountStateVersion: 2,
      })

    expect(fake.batchCalls()).toBe(0)
    expect(fake.grantedRole()).toBeNull()
  })

  it('does not activate a blocked account from an email-verification callback', async () => {
    const fake = fakeDb({ state: 'BANNED', version: 4 })

    await expect(activateEmailVerifiedAccount(fake.db, '42', '2026-10-06T20:00:00.000Z'))
      .resolves.toEqual({
        activated: false,
        accountState: 'BANNED',
        accountStateVersion: 4,
      })

    expect(fake.batchCalls()).toBe(0)
    expect(fake.grantedRole()).toBeNull()
  })
})
