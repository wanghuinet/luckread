export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ service: 'luck06-async', status: 'ok', role: 'async' })
    }
    return new Response(null, { status: 404 })
  },
  async queue(batch: MessageBatch<unknown>): Promise<void> {
    for (const message of batch.messages) message.ack()
  },
}
