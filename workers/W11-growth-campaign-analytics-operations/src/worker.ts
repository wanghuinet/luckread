interface AnalyticsHealthStatement {
  first(): Promise<{ ok: number } | null>
}

interface AnalyticsHealthDatabase {
  prepare(query: string): AnalyticsHealthStatement
}

export interface W11Env {
  D1_05: AnalyticsHealthDatabase
}

const jsonResponse = (body: Record<string, string>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })

const worker = {
  async fetch(request: Request, env: W11Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname !== '/healthz') {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    try {
      const probe = await env.D1_05.prepare('SELECT 1 AS ok').first()
      if (probe?.ok !== 1) throw new Error('D1-05 health probe returned no result')
      return jsonResponse({ worker: 'W11', status: 'ok', database: 'reachable' })
    } catch {
      // Do not leak provider errors, SQL details or configuration to callers.
      return jsonResponse({ worker: 'W11', status: 'degraded', database: 'unavailable' }, 503)
    }
  },
}

export default worker
