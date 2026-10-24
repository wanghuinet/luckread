import { describe, expect, it } from 'vitest'
import { createOTP } from '@better-auth/utils/otp'
import { consumeTotpTimeStep, matchTotpTimeStep } from './totp-replay-guard.js'

const SECRET = 'luckread-totp-test-secret'
const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const STEP = Math.floor(NOW / 30_000)

describe('TOTP time-step replay guard', () => {
  it('identifies the exact current accepted step', async () => {
    const code = await createOTP(SECRET).hotp(STEP)
    await expect(matchTotpTimeStep(SECRET, code, NOW)).resolves.toEqual({
      kind: 'matched',
      timeStep: STEP,
    })
  })

  it('identifies an adjacent-window code and returns its actual step', async () => {
    const code = await createOTP(SECRET).hotp(STEP - 1)
    await expect(matchTotpTimeStep(SECRET, code, NOW)).resolves.toEqual({
      kind: 'matched',
      timeStep: STEP - 1,
    })
  })

  it('rejects invalid code shapes and values', async () => {
    await expect(matchTotpTimeStep(SECRET, '000000', NOW)).resolves.toEqual({ kind: 'invalid' })
    await expect(matchTotpTimeStep(SECRET, ' 12345', NOW)).resolves.toEqual({ kind: 'invalid' })
  })

  it('rejects invalid reservation inputs before touching D1', async () => {
    const db = { prepare: () => { throw new Error('must not query') } } as unknown as D1Database
    await expect(consumeTotpTimeStep(db, '', STEP)).rejects.toThrow('invalid TOTP replay-guard input')
    await expect(consumeTotpTimeStep(db, 'user-123', -1)).rejects.toThrow('invalid TOTP replay-guard input')
  })

  it('atomically consumes a step once and rejects replay, older steps and other users', async () => {
    const state: { userId: string; lastStep: number | null } = { userId: 'user-123', lastStep: null }
    const db = {
      prepare(sql: string) {
        expect(sql).toContain('lastAcceptedTotpTimeStep IS NULL OR lastAcceptedTotpTimeStep < ?')
        let values: unknown[] = []
        return {
          bind(...next: unknown[]) { values = next; return this },
          async run() {
            const [writeStep, userId, comparisonStep] = values as [number, string, number]
            const eligible = userId === state.userId &&
              (state.lastStep === null || state.lastStep < comparisonStep)
            if (eligible) state.lastStep = writeStep
            return { meta: { changes: eligible ? 1 : 0 } }
          },
        }
      },
    } as unknown as D1Database

    expect(await consumeTotpTimeStep(db, 'user-123', STEP)).toBe(true)
    expect(await consumeTotpTimeStep(db, 'user-123', STEP)).toBe(false)
    expect(await consumeTotpTimeStep(db, 'user-123', STEP - 1)).toBe(false)
    expect(await consumeTotpTimeStep(db, 'other-user', STEP + 1)).toBe(false)
    expect(state.lastStep).toBe(STEP)
  })

  it('has one winner when concurrent duplicate steps target the atomic conditional update', async () => {
    const state: { lastStep: number | null } = { lastStep: null }
    const db = {
      prepare(sql: string) {
        expect(sql).toContain('lastAcceptedTotpTimeStep IS NULL OR lastAcceptedTotpTimeStep < ?')
        let values: unknown[] = []
        return {
          bind(...next: unknown[]) { values = next; return this },
          async run() {
            const [writeStep, , comparisonStep] = values as [number, string, number]
            const eligible = state.lastStep === null || state.lastStep < comparisonStep
            if (eligible) state.lastStep = writeStep
            return { meta: { changes: eligible ? 1 : 0 } }
          },
        }
      },
    } as unknown as D1Database
    const results = await Promise.all([
      consumeTotpTimeStep(db, 'user-123', STEP),
      consumeTotpTimeStep(db, 'user-123', STEP),
    ])
    expect(results.sort()).toEqual([false, true])
  })
})
