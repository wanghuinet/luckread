import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import {
  resolveLayerForSubject,
  type RoleLayerStore,
} from './role-layer-store.js'
import { createPostgresRoleLayerStore } from '../neon/role-layer-postgres.js'

const NOW = '2026-11-10T12:00:00.000Z'

describe('W02 role-layer authority boundary', () => {
  it('reads account state from the authority store and evaluates using server time', async () => {
    const store: RoleLayerStore = {
      readAccountState: vi.fn().mockResolvedValue('ACTIVE'),
      resolveGlobalLayer: vi.fn().mockResolvedValue({ decision: 'ALLOW', layer: 'L2' }),
    }

    await expect(resolveLayerForSubject(store, 'subject-1', NOW)).resolves.toEqual({
      decision: 'ALLOW',
      layer: 'L2',
    })
    expect(store.readAccountState).toHaveBeenCalledWith('subject-1')
    expect(store.resolveGlobalLayer).toHaveBeenCalledWith('subject-1', 'ACTIVE', NOW)
  })

  it('denies missing accounts without invoking role resolution', async () => {
    const store: RoleLayerStore = {
      readAccountState: vi.fn().mockResolvedValue(null),
      resolveGlobalLayer: vi.fn(),
    }

    await expect(resolveLayerForSubject(store, 'missing-subject', NOW)).resolves.toEqual({
      decision: 'DENY',
    })
    expect(store.resolveGlobalLayer).not.toHaveBeenCalled()
  })

  it('passes blocked states to the canonical resolver instead of trusting caller state', async () => {
    const store: RoleLayerStore = {
      readAccountState: vi.fn().mockResolvedValue('SUSPENDED'),
      resolveGlobalLayer: vi.fn().mockResolvedValue({ decision: 'DENY' }),
    }

    await expect(resolveLayerForSubject(store, 'subject-1', NOW)).resolves.toEqual({
      decision: 'DENY',
    })
    expect(store.resolveGlobalLayer).toHaveBeenCalledWith('subject-1', 'SUSPENDED', NOW)
  })

  it('rejects invalid subjects and evaluation timestamps before storage access', async () => {
    const store: RoleLayerStore = {
      readAccountState: vi.fn(),
      resolveGlobalLayer: vi.fn(),
    }

    await expect(resolveLayerForSubject(store, '', NOW)).rejects.toThrow(
      'invalid W02 role-layer resolution input',
    )
    await expect(resolveLayerForSubject(store, 'subject-1', 'not-a-date')).rejects.toThrow(
      'invalid W02 role-layer resolution input',
    )
    await expect(resolveLayerForSubject(store, 'x'.repeat(129), NOW)).rejects.toThrow(
      'invalid W02 role-layer resolution input',
    )
    expect(store.readAccountState).not.toHaveBeenCalled()
  })

  it('uses the existing PostgreSQL role-layer adapter and numbered parameter placeholders', async () => {
    const query = vi.fn(async () => ({ rows: [{ accountState: 'ACTIVE' }] }))
    const pool = { query } as unknown as Pool
    const store = createPostgresRoleLayerStore(pool)

    await expect(store.readAccountState('subject-1')).resolves.toBe('ACTIVE')
    expect(query).toHaveBeenCalledWith(
      'SELECT account_state AS "accountState" FROM "user" WHERE id = $1 LIMIT 1',
      ['subject-1'],
    )
  })
})
