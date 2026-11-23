import { describe, expect, it } from 'vitest'
import { createOTP } from '@better-auth/utils/otp'
import { matchTotpTimeStep } from './totp-replay-guard.js'

const SECRET = 'luckread-totp-test-secret'
const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const STEP = Math.floor(NOW / 30_000)

describe('TOTP time-step matching', () => {
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
})
