import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'

export type TotpSecret = string | Uint8Array

const BASE32_PREFIX = 'base32:'

/**
 * Mirror Better Auth's TOTP secret decoding contract. Imported provider
 * secrets use a base32: prefix; locally generated secrets remain UTF-8 strings.
 */
export function decodeTotpSecret(secret: string): TotpSecret {
  if (!secret.startsWith(BASE32_PREFIX)) return secret
  return base32.decode(secret.slice(BASE32_PREFIX.length).toUpperCase())
}

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
  secret: TotpSecret,
  code: string,
  nowMs = Date.now(),
  periodSeconds = 30,
  window = 1,
): Promise<TotpStepMatch> {
  if (
    !((typeof secret === 'string' && secret.length > 0) ||
      (secret instanceof Uint8Array && secret.byteLength > 0)) ||
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
