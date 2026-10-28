import {
  forwardW07HyperswitchWebhook,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function readBoundedRawBody(request: Request): Promise<ArrayBuffer | Response> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook request length is invalid')
    }
    if (Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES) {
      return errorResponse(413, 'WEBHOOK_REJECTED', 'Webhook request is too large')
    }
  }
  if (!request.body) return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook body is required')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > MAX_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return errorResponse(413, 'WEBHOOK_REJECTED', 'Webhook request is too large')
      }
      chunks.push(part.value)
    }
  } catch {
    await reader.cancel().catch(() => undefined)
    return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook body could not be read')
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer as ArrayBuffer
}

/**
 * Public provider callback ingress. W01 deliberately does not authenticate a
 * user, parse/re-serialize JSON, trust the payload, or store it. W07 verifies
 * the original bytes with HMAC-SHA512 and owns durable event/payment state.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await readBoundedRawBody(request)
  if (rawBody instanceof Response) return rawBody

  try {
    return await forwardW07HyperswitchWebhook({ request, rawBody })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment webhook service unavailable')
  }
}
