import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import accountStateEnum from '../../../../contracts/enums/account-state.json'
import accountStateMachine from '../../../../contracts/state-machines/account.json'
import { AccountStateTransitionError } from './account-state-transition.js'
import {
  AccountStateTransitionPostgresError,
  applyModeratorAccountStateTransitionPostgres,
} from '../neon/account-state-transition-postgres.js'
import { createPostgresAccountStateTransitionStore } from '../neon/account-state-transition-store-postgres.js'

type TransitionRule = {
  from: string
  to: string
  actor: string
  permission: string | null
  precondition?: string
  requiresApproval?: boolean | string
}

const canonicalStates = new Set<string>(accountStateEnum.enum)
const transitionRules = accountStateMachine['x-transitions'] as TransitionRule[]

describe('W02 account-state contract and Neon boundary', () => {
  it('keeps every transition inside the canonical account-state and actor enums', () => {
    expect(transitionRules.length).toBeGreaterThan(0)
    for (const rule of transitionRules) {
      expect(canonicalStates.has(rule.from), rule.from).toBe(true)
      expect(canonicalStates.has(rule.to), rule.to).toBe(true)
      expect(['user', 'operator', 'admin', 'system']).toContain(rule.actor)
      expect(rule).toHaveProperty('permission')
    }

    expect(transitionRules).toContainEqual(expect.objectContaining({
      from: 'DELETED',
      to: 'REACTIVATED',
      actor: 'user',
      precondition: 'within_reactivation_window',
    }))
    expect(transitionRules.some((rule) => rule.from === 'DELETED' && rule.to === 'ACTIVE')).toBe(false)
  })

  it('rejects malformed transition input before opening a PostgreSQL connection', async () => {
    const connect = vi.fn(() => {
      throw new Error('connection must not be opened for invalid input')
    })
    const pool = { connect } as unknown as Pool

    await expect(applyModeratorAccountStateTransitionPostgres(pool, {
      subjectId: '',
      targetUserId: 'target-user',
      to: 'SUSPENDED',
      reason: 'contract boundary test',
      expectedVersion: 1,
    })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    expect(connect).not.toHaveBeenCalled()
  })

  it('maps Neon persistence validation errors to the shared W02 error contract', async () => {
    const connect = vi.fn(() => {
      throw new Error('connection must not be opened for invalid input')
    })
    const store = createPostgresAccountStateTransitionStore({ connect } as unknown as Pool)

    let caught: unknown
    try {
      await store.transition({
        subjectId: '',
        targetUserId: 'target-user',
        to: 'SUSPENDED',
        reason: 'contract boundary test',
        expectedVersion: 1,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AccountStateTransitionError)
    expect(caught).toMatchObject({ code: 'INVALID_INPUT' })
    expect(caught).not.toBeInstanceOf(AccountStateTransitionPostgresError)
    expect(connect).not.toHaveBeenCalled()
  })
})
