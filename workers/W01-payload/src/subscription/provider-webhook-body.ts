export type WebhookBodyReadErrorFactory = (status: number, code: string, message: string) => Response;

export const MAX_PROVIDER_WEBHOOK_BODY_BYTES = 1024 * 1024;

/** Read exact provider bytes once, with a hard streaming cap before buffering. */
export async function readBoundedProviderWebhookBody(
  request: Request,
  errorResponse: WebhookBodyReadErrorFactory,
): Promise<ArrayBuffer | Response> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook request length is invalid');
    }
    if (Number(declaredLength) > MAX_PROVIDER_WEBHOOK_BODY_BYTES) {
      return errorResponse(413, 'WEBHOOK_REJECTED', 'Webhook request is too large');
    }
  }
  if (!request.body) return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook body is required');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_PROVIDER_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return errorResponse(413, 'WEBHOOK_REJECTED', 'Webhook request is too large');
      }
      chunks.push(part.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook body could not be read');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer as ArrayBuffer;
}
