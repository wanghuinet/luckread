export type CanonicalJsonErrorCode =
  | 'INVALID_MAX_BYTES'
  | 'INVALID_JSON_VALUE'
  | 'PAYLOAD_TOO_LARGE'
  | 'HASH_UNAVAILABLE'

export class CanonicalJsonError extends Error {
  constructor(
    readonly code: CanonicalJsonErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CanonicalJsonError'
  }
}

const invalidValue = (): never => {
  throw new CanonicalJsonError(
    'INVALID_JSON_VALUE',
    'Value is not a safe JSON-compatible payload',
  )
}

/**
 * Deterministic, whitespace-free JSON for idempotency payload hashing.
 *
 * Only JSON primitives, dense arrays, and plain objects are accepted. This
 * rejects values JSON.stringify would silently omit or transform (undefined,
 * sparse arrays, accessors, non-finite numbers, custom prototypes, etc.).
 * Object keys are sorted recursively using JavaScript's stable code-unit order.
 *
 * The caller must supply the byte limit declared by the owning task contract;
 * this function intentionally does not invent a platform-wide payload limit.
 */
export function canonicalizeJsonForIdempotency(
  value: unknown,
  maxBytes: number,
): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new CanonicalJsonError('INVALID_MAX_BYTES', 'maxBytes must be a positive safe integer')
  }

  const ancestors = new WeakSet<object>()

  const encode = (current: unknown): string => {
    if (current === null) return 'null'

    if (typeof current === 'string' || typeof current === 'boolean') {
      return JSON.stringify(current)
    }

    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return invalidValue()
      return JSON.stringify(current)
    }

    if (typeof current !== 'object') return invalidValue()

    if (ancestors.has(current)) return invalidValue()
    ancestors.add(current)

    try {
      if (Array.isArray(current)) {
        if (Object.getOwnPropertySymbols(current).length > 0) return invalidValue()

        const propertyNames = Object.getOwnPropertyNames(current)
        if (
          propertyNames.length !== current.length + 1 ||
          propertyNames.some((name) =>
            name !== 'length' && !/^(0|[1-9][0-9]*)$/.test(name),
          )
        ) {
          return invalidValue()
        }

        const items: string[] = []
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index))
          if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          ) {
            return invalidValue()
          }
          items.push(encode(descriptor.value))
        }

        return '[' + items.join(',') + ']'
      }

      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) return invalidValue()
      if (Object.getOwnPropertySymbols(current).length > 0) return invalidValue()

      const propertyNames = Object.getOwnPropertyNames(current)
      const enumerableNames = Object.keys(current)
      if (propertyNames.length !== enumerableNames.length) return invalidValue()

      const keys = enumerableNames.sort()
      const fields: string[] = []
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key)
        if (
          !descriptor ||
          !descriptor.enumerable ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
          return invalidValue()
        }

        fields.push(JSON.stringify(key) + ':' + encode(descriptor.value))
      }

      return '{' + fields.join(',') + '}'
    } finally {
      ancestors.delete(current)
    }
  }

  const canonical = encode(value)
  const byteLength = new TextEncoder().encode(canonical).byteLength

  if (byteLength > maxBytes) {
    throw new CanonicalJsonError('PAYLOAD_TOO_LARGE', 'Canonical JSON exceeds the task contract limit')
  }

  return canonical
}

/**
 * SHA-256 of the canonical UTF-8 JSON, formatted as a lowercase hex digest.
 * A SubtleCrypto implementation can be injected for deterministic tests.
 */
export async function sha256CanonicalJsonForIdempotency(
  value: unknown,
  maxBytes: number,
  subtle: Pick<SubtleCrypto, 'digest'> = globalThis.crypto.subtle,
): Promise<string> {
  const canonical = canonicalizeJsonForIdempotency(value, maxBytes)
  const bytes = new TextEncoder().encode(canonical)

  let digest: ArrayBuffer
  try {
    digest = await subtle.digest('SHA-256', bytes)
  } catch {
    throw new CanonicalJsonError('HASH_UNAVAILABLE', 'SHA-256 payload hashing is unavailable')
  }

  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

  return 'sha256:' + hex
}
