import { createOTP } from '@better-auth/utils/otp'

export type TotpStepMatch =
  | { kind: 'invalid' }
  | { kind: 'ambiguous' }
  | { kind: 'matched'; timeStep: number }

const constantTimeEqual = (provided: string, expected: string): boolean => {
  let difference = provided.length ^ expected.length
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

/**
 * Find the exact accepted RFC 6238 time step using the same 6-digit,
 * 30-second, SHA-1 default as Better Auth's pinned TOTP implementation.
 * Ambiguous collisions fail closed rather than reserving an arbitrary step.
 */
export async function matchTotpTimeStep(
  secret: string,
  code: string,
  nowMs = Date.now(),
  periodSeconds = 30,
  window = 1,
): Promise<TotpStepMatch> {
  if (
    typeof secret !== 'string' ||
    secret.length < 1 ||
    typeof code !== 'string' ||
    !/^\d{6}$/.test(code) ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(periodSeconds) ||
    periodSeconds < 1 ||
    periodSeconds > 300 ||
    !Number.isSafeInteger(window) ||
    window < 0 ||
    window > 2
  ) {
    return { kind: 'invalid' }
  }

  const currentStep = Math.floor(nowMs / (periodSeconds * 1000))
  const totp = createOTP(secret, { digits: 6, period: periodSeconds })
  const matches: number[] = []
  for (let step = Math.max(0, currentStep - window); step <= currentStep + window; step += 1) {
    const expected = await totp.hotp(step)
    if (constantTimeEqual(code, expected)) matches.push(step)
  }

  if (matches.length === 0) return { kind: 'invalid' }
  if (matches.length > 1) return { kind: 'ambiguous' }
  return { kind: 'matched', timeStep: matches[0] }
}
