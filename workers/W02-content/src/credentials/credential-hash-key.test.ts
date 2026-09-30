import { describe, expect, it } from 'vitest'
import {
  credentialHashKeyCandidates,
  CredentialHashKeyError,
  resolveCredentialHashKeySet,
} from './credential-hash-key.js'

describe('AUTH-003 credential hash key boundary', () => {
  const active = 'a'.repeat(48)
  const previous = 'p'.repeat(48)

  it('requires the canonical active server-side key', () => {
    expect(resolveCredentialHashKeySet({ AUTH003_CREDENTIAL_HASH_KEY: active })).toEqual({ active })
    expect(() => resolveCredentialHashKeySet({})).toThrow(CredentialHashKeyError)
  })

  it('admits an optional previous key only for rotation overlap', () => {
    const keys = resolveCredentialHashKeySet({
      AUTH003_CREDENTIAL_HASH_KEY: active,
      AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS: previous,
    })

    expect(keys).toEqual({ active, previous })
    expect(credentialHashKeyCandidates(keys)).toEqual([active, previous])
  })

  it('fails closed for invalid active or previous key material', () => {
    expect(() => resolveCredentialHashKeySet({
      AUTH003_CREDENTIAL_HASH_KEY: 'too-short',
    })).toThrow(/unavailable/)

    expect(() => resolveCredentialHashKeySet({
      AUTH003_CREDENTIAL_HASH_KEY: active,
      AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS: 'too-short',
    })).toThrow(/unavailable/)
  })

  it('does not expose secret material through error messages', () => {
    const secret = 'short-secret-value'

    try {
      resolveCredentialHashKeySet({
        AUTH003_CREDENTIAL_HASH_KEY: secret,
      })
      throw new Error('expected missing active key failure')
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialHashKeyError)
      expect(String((error as Error).message)).not.toContain(secret)
    }
  })
})
