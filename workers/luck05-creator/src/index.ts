export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ service: 'luck05-creator', status: 'ok', role: 'creator-center' })
    }
    return new Response(null, { status: 404 })
  },
}
