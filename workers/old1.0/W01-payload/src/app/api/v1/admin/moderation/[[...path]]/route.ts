import {
  callW06Moderation,
  W06ModerationClientError,
} from '../../../../../../moderation/w06-moderation-client.js'
import { resolveCookieContentPrincipal } from '../../../../../../content/w03-content-client.js'

const jsonError = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const resolvePath = (segments: string[] | undefined): { pathname: string; needsBody: boolean } | null => {
  const parts = (segments ?? []).map((segment) => decodeURIComponent(segment))
  if (parts.length === 1 && parts[0] === 'queue') {
    return { pathname: '/admin/moderation/queue', needsBody: false }
  }
  if (parts.length === 2 && parts[0] === 'cases') {
    return { pathname: `/admin/moderation/cases/${encodeURIComponent(parts[1])}`, needsBody: false }
  }
  if (parts.length === 3 && parts[0] === 'cases' && parts[2] === 'decision') {
    return { pathname: `/admin/moderation/cases/${encodeURIComponent(parts[1])}/decision`, needsBody: true }
  }
  return null
}

const run = async (request: Request, context: { params: Promise<{ path?: string[] }> }) => {
  const resolved = resolvePath((await context.params).path)
  if (!resolved) return jsonError(404, 'NOT_FOUND', 'Moderation route not found')

  const principal = await resolveCookieContentPrincipal(request)
  if (principal instanceof Response) return principal

  let body: unknown = undefined
  if (resolved.needsBody) {
    try {
      body = await request.json()
    } catch {
      return jsonError(400, 'VALIDATION_FAILED', 'Invalid moderation request')
    }
  }

  try {
    return await callW06Moderation({
      request,
      pathname: resolved.pathname,
      method: request.method,
      principal,
      body,
    })
  } catch (error) {
    if (error instanceof W06ModerationClientError) {
      return jsonError(error.status, error.code, error.message)
    }
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Moderation service unavailable')
  }
}

export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return run(request, context)
}

export async function POST(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const parts = (await context.params).path ?? []
  if (!(parts.length === 3 && parts[2] === 'decision')) {
    return jsonError(404, 'NOT_FOUND', 'Moderation route not found')
  }
  return run(request, { params: Promise.resolve({ path: parts }) })
}

export const dynamic = 'force-dynamic'
