interface Env {
  D1_03: D1Database
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({
        service: 'W06',
        status: 'ok',
        auditPersistence: 'not-enabled',
        d1Binding: Boolean(env.D1_03),
      })
    }

    return new Response('W06 governance worker', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
}
