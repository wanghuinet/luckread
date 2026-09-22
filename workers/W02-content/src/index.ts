import { resolveGlobalLayer } from './authz/role-assignment.js'

interface Env { D1_01: D1Database }

type ResolveLayerRequest = {
  subjectId: string
  accountState: string
  now?: string
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/internal/authz/resolve-layer') {
      let body: ResolveLayerRequest
      try {
        body = await request.json<ResolveLayerRequest>()
      } catch {
        return json({ decision: 'DENY' }, 400)
      }

      if (!body || typeof body.subjectId !== 'string' || typeof body.accountState !== 'string') {
        return json({ decision: 'DENY' }, 400)
      }

      try {
        const result = await resolveGlobalLayer(env.D1_01, body.subjectId, body.accountState, body.now)
        return json(result)
      } catch {
        return json({ decision: 'DENY' }, 503)
      }
    }
    return new Response(null, { status: 404 })
  },
}
