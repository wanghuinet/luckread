import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { codeForStep, currentStep, decodeBase32, parseTotpUri } from './auth-007-totp.mjs'

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('AUTH-007 live E2E TOTP helpers', () => {
  it('decodes the RFC-compatible Base32 test secret', () => {
    assert.equal(decodeBase32(RFC_SECRET).toString('ascii'), '12345678901234567890')
  })

  it('generates the known six-digit SHA-1 TOTP for Unix time 59 seconds', () => {
    assert.equal(codeForStep(RFC_SECRET, 1, 6, 'sha1'), '287082')
  })

  it('parses the required six-digit 30-second SHA-1 authenticator URI', () => {
    assert.deepEqual(parseTotpUri(
      'otpauth://totp/LuckRead:test%40example.com?secret=' + RFC_SECRET +
      '&issuer=LuckRead&digits=6&period=30&algorithm=SHA1',
    ), { secret: RFC_SECRET, digits: 6, period: 30, algorithm: 'sha1' })
  })

  it('rejects non-TOTP, unsupported parameters, and malformed secrets', () => {
    assert.throws(() => parseTotpUri('https://example.com/not-totp'), /invalid TOTP URI/)
    assert.throws(() => parseTotpUri('otpauth://hotp/LuckRead?secret=' + RFC_SECRET), /invalid TOTP URI/)
    assert.throws(() => parseTotpUri('otpauth://totp/LuckRead?secret=' + RFC_SECRET + '&period=60'), /unsupported TOTP parameters/)
    assert.throws(() => decodeBase32('not-a-valid-base32-secret!'), /invalid Base32 secret/)
  })

  it('uses integer time steps and rejects invalid clock input', () => {
    assert.equal(currentStep(30, 59_000), 1)
    assert.throws(() => currentStep(0, 1000), /invalid TOTP clock/)
  })
})
