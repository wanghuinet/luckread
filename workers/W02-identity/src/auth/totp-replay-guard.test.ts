import { describe, expect, it } from 'vitest'
import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import { decodeTotpSecret, matchTotpTimeStep } from './totp-replay-guard.js'

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

  it('matches Better Auth base32-prefixed imported secrets using decoded bytes', async () => {
    const encoded = base32.encode(new TextEncoder().encode(SECRET), { padding: false }).toLowerCase()
    const decoded = decodeTotpSecret('base32:' + encoded)
    expect(decoded).toBeInstanceOf(Uint8Array)
    const code = await createOTP(decoded).hotp(STEP)
    await expect(matchTotpTimeStep(decoded, code, NOW)).resolves.toEqual({
      kind: 'matched',
      timeStep: STEP,
    })
  })

  it('leaves locally generated unprefixed secrets unchanged', () => {
    expect(decodeTotpSecret(SECRET)).toBe(SECRET)
  })

  it('rejects invalid code shapes and values', async () => {
    await expect(matchTotpTimeStep(SECRET, '000000', NOW)).resolves.toEqual({ kind: 'invalid' })
    await expect(matchTotpTimeStep(SECRET, ' 12345', NOW)).resolves.toEqual({ kind: 'invalid' })
  })
})
