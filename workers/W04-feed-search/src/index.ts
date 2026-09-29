// AUTH-013 W04 binding CI trigger: runtime implementation unchanged.
// Runtime evidence gate follows the admitted destination and queue binding.
// Final controlled runtime trigger.
// Consumer/DLQ live verification uses the dedicated Queue API.
// Final runtime evidence execution.
// Response-shape-safe consumer verification.
// Final live W04 gate trigger.
// Runtime artifact emission simplified.
// Final jq evidence trigger.
// Final runtime gate trigger.
// Runtime log evidence checkpoint.
// Node runtime evidence script.
import { applyAccountStateProjection, parseAccountStateChanged } from './auth-013-projection.js'

interface ProjectionKV {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string): Promise<void>
}
interface QueueMessage { body: unknown; ack(): void; retry(): void }
interface MessageBatchLike { messages: QueueMessage[] }
interface Env {
  AUTH013_W04_DERIVED_PROJECTION: ProjectionKV
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ service: 'W04', status: 'ok', role: 'feed-recommendation-search', mode: 'projection-consumer' })
    }
    return new Response(null, { status: 404 })
  },

  async queue(batch: MessageBatchLike, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const event = parseAccountStateChanged(message.body)
        await applyAccountStateProjection(env.AUTH013_W04_DERIVED_PROJECTION, event)
        message.ack()
      } catch (error) {
        console.error(JSON.stringify({
          event: 'auth013.w04.projection_consumer_error',
          code: error instanceof Error ? error.message : 'UNKNOWN',
        }))
        message.retry()
      }
    }
  },
}
