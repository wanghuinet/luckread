import { createHmac } from 'node:crypto'

export function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = String(value || '').replace(/=+$/g, '').toUpperCase()
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new TypeError('invalid Base32 secret')
  }
  let bits = 0
  let accumulator = 0
  const bytes = []
  for (const character of normalized) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new TypeError('invalid Base32 secret')
    accumulator = (accumulator << 5) | digit
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >> bits) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

export function codeForStep(secret, step, digits = 6, algorithm = 'sha1') {
  if (!Number.isSafeInteger(step) || step < 0 || ![6, 8].includes(digits) ||
      !['sha1', 'sha256', 'sha512'].includes(String(algorithm).toLowerCase())) {
    throw new TypeError('invalid TOTP parameters')
  }
  const key = decodeBase32(secret)
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac(String(algorithm).toLowerCase(), key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(binary % (10 ** digits)).padStart(digits, '0')
}

export function parseTotpUri(value) {
  let uri
  try {
    uri = new URL(value)
  } catch {
    throw new TypeError('invalid TOTP URI')
  }
  if (uri.protocol !== 'otpauth:' || uri.hostname.toLowerCase() !== 'totp') {
    throw new TypeError('invalid TOTP URI')
  }
  const secret = uri.searchParams.get('secret') || ''
  const digits = Number(uri.searchParams.get('digits') || '6')
  const period = Number(uri.searchParams.get('period') || '30')
  const algorithm = (uri.searchParams.get('algorithm') || 'SHA1').toLowerCase()
  if (!Number.isInteger(digits) || digits !== 6 || !Number.isInteger(period) || period !== 30 ||
      algorithm !== 'sha1') {
    throw new TypeError('unsupported TOTP parameters')
  }
  decodeBase32(secret)
  return { secret, digits, period, algorithm }
}

export function currentStep(periodSeconds, nowMs = Date.now()) {
  if (!Number.isSafeInteger(periodSeconds) || periodSeconds < 1 ||
      !Number.isFinite(nowMs) || nowMs < 0) {
    throw new TypeError('invalid TOTP clock')
  }
  return Math.floor(nowMs / (periodSeconds * 1000))
}
