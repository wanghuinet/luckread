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
  const encoder = new TextEncoder()
  let encodedBytes = 0

  // Charge each serialized fragment before it is retained in a parent buffer.
  // This avoids first building an arbitrarily large canonical string and only
  // then enforcing the task's byte limit.
  const append = (fragment: string): string => {
    const bytes = encoder.encode(fragment).byteLength
    if (bytes > maxBytes - encodedBytes) {
      throw new CanonicalJsonError('PAYLOAD_TOO_LARGE', 'Canonical JSON exceeds the task contract limit')
    }
    encodedBytes += bytes
    return fragment
  }

  const encodeString = (text: string): string => {
    // Every UTF-16 code unit contributes at least one byte to JSON string
    // output; reject obviously oversized strings before JSON.stringify creates
    // an escaped copy. append() then checks the exact UTF-8 serialized size.
    if (text.length > maxBytes) {
      throw new CanonicalJsonError('PAYLOAD_TOO_LARGE', 'Canonical JSON exceeds the task contract limit')
    }
    return append(JSON.stringify(text))
  }

  const encode = (current: unknown): string => {
    if (current === null) return append('null')

    if (typeof current === 'string') return encodeString(current)
    if (typeof current === 'boolean') return append(current ? 'true' : 'false')

    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return invalidValue()
      return append(JSON.stringify(current))
    }

    if (typeof current !== 'object') return invalidValue()

    if (ancestors.has(current)) return invalidValue()
    ancestors.add(current)

    try {
      if (Array.isArray(current)) {
        // Reject inherited numeric properties: a handler could read a value
        // that the canonical JSON (and therefore the hash) would omit.
        if (Object.getPrototypeOf(current) !== Array.prototype) return invalidValue()
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

        append('[')
        const items: string[] = []
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0) append(',')
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
        append(']')

        return '[' + items.join(',') + ']'
      }

      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) return invalidValue()
      if (Object.getOwnPropertySymbols(current).length > 0) return invalidValue()

      const propertyNames = Object.getOwnPropertyNames(current)
      const enumerableNames = Object.keys(current)
      if (propertyNames.length !== enumerableNames.length) return invalidValue()

      const keys = enumerableNames.sort()
      append('{')
      const fields: string[] = []
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) append(',')
        const key = keys[index]!
        const descriptor = Object.getOwnPropertyDescriptor(current, key)
        if (
          !descriptor ||
          !descriptor.enumerable ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
          return invalidValue()
        }

        const encodedKey = encodeString(key)
        append(':')
        fields.push(encodedKey + ':' + encode(descriptor.value))
      }
      append('}')

      return '{' + fields.join(',') + '}'
    } finally {
      ancestors.delete(current)
    }
  }

  return encode(value)
}

/**
 * SHA-256 of already-serialized bytes as lowercase hexadecimal.
 *
 * Keep this primitive separate from canonical JSON serialization so callers
 * with an existing stable byte representation can reuse the digest without
 * changing persisted identities.
 */
export async function sha256BytesToHex(
  bytes: Uint8Array,
  subtle: Pick<SubtleCrypto, 'digest'> = globalThis.crypto.subtle,
): Promise<string> {
  let digest: ArrayBuffer
  try {
    digest = await subtle.digest('SHA-256', bytes)
  } catch {
    throw new CanonicalJsonError('HASH_UNAVAILABLE', 'SHA-256 payload hashing is unavailable')
  }

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
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

  return 'sha256:' + await sha256BytesToHex(bytes, subtle)
}
