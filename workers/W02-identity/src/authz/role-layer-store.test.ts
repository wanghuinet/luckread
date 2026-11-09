import { describe, expect, it, vi } from 'vitest'

import {
  createD1RoleLayerStore,
  resolveLayerForSubject,
  type RoleLayerStore,
} from './role-layer-store.js'

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

  it('keeps the production adapter on the existing D1 authority query', async () => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ accountState: 'ACTIVE' }),
    }
    const db = {
      prepare: vi.fn().mockReturnValue(statement),
    } as unknown as D1Database
    const store = createD1RoleLayerStore(db)

    await expect(store.readAccountState('subject-1')).resolves.toBe('ACTIVE')
    expect(db.prepare).toHaveBeenCalledWith(
      'SELECT account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
    )
    expect(statement.bind).toHaveBeenCalledWith('subject-1')
  })
})
