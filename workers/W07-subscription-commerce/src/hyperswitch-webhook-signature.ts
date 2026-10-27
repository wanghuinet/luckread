/**
 * Verify Hyperswitch's outgoing webhook signature without parsing or
 * re-serializing the request body. Callers must pass the exact raw bytes from
 * Request.arrayBuffer() and persist/deduplicate event_id separately before
 * applying any business transition.
 *
 * Hyperswitch signs the serialized request bytes with HMAC-SHA512 and emits
 * the hex digest in X-Webhook-Signature-512.
 */
const SHA512_HEX_LENGTH = 128;
const SHA512_HEX_PATTERN = /^[0-9a-fA-F]{128}$/;

function constantTimeHexEqual(expected: string, supplied: string): boolean {
  if (expected.length !== SHA512_HEX_LENGTH || supplied.length !== SHA512_HEX_LENGTH) return false;

  let difference = 0;
  for (let index = 0; index < SHA512_HEX_LENGTH; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

function toHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

/**
 * Returns false for missing/malformed configuration, missing signatures,
 * mismatched bodies, or cryptographic errors. It never throws to the webhook
 * route, so an invalid signature can be rejected with a uniform response.
 */
export async function verifyHyperswitchWebhookSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (typeof secret !== 'string' || secret.trim().length === 0) return false;
  if (typeof signatureHeader !== 'string') return false;

  const signature = signatureHeader.trim();
  if (!SHA512_HEX_PATTERN.test(signature)) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign('HMAC', key, rawBody);
    const expected = toHex(new Uint8Array(digest));
    return constantTimeHexEqual(expected, signature.toLowerCase());
  } catch {
    // Fail closed if the crypto runtime or supplied input is invalid.
    return false;
  }
}
