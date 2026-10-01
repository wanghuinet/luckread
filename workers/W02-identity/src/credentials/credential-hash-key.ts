export type CredentialHashKeySet = {
  active: string
  previous?: string
}

export type CredentialHashSecretEnv = {
  AUTH003_CREDENTIAL_HASH_KEY?: unknown
  AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS?: unknown
}

export class CredentialHashKeyError extends Error {
  constructor(
    readonly code: 'MISSING_ACTIVE_KEY' | 'INVALID_ACTIVE_KEY' | 'INVALID_PREVIOUS_KEY',
    message: string,
  ) {
    super(message)
  }
}

const MIN_SECRET_LENGTH = 32

function assertKey(value: unknown, code: CredentialHashKeyError['code']): asserts value is string {
  if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) {
    throw new CredentialHashKeyError(code, 'credential protection is unavailable')
  }
}

export function resolveCredentialHashKeySet(env: CredentialHashSecretEnv): CredentialHashKeySet {
  assertKey(env.AUTH003_CREDENTIAL_HASH_KEY, 'MISSING_ACTIVE_KEY')

  if (env.AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS == null || env.AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS === '') {
    return { active: env.AUTH003_CREDENTIAL_HASH_KEY }
  }

  assertKey(env.AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS, 'INVALID_PREVIOUS_KEY')

  return {
    active: env.AUTH003_CREDENTIAL_HASH_KEY,
    previous: env.AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS,
  }
}

export function credentialHashKeyCandidates(keys: CredentialHashKeySet): string[] {
  return keys.previous ? [keys.active, keys.previous] : [keys.active]
}
