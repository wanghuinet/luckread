import { applyAccountStateProjection, parseAccountStateChanged } from './auth-013-projection.js'

interface Env {
  AUTH013_W04_DERIVED_PROJECTION: KVNamespace
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

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
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
