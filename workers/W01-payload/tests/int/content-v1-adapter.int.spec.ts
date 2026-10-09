import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 content adapter', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/contents/[contentId]/route.ts'),
    'utf8',
  )

  it('delegates content mutations to W03 without duplicating persistence logic', () => {
    expect(route).toContain('resolveContentPrincipal')
    expect(route).toContain('callW03Content')
    expect(route).toContain("method: 'PATCH'")
    expect(route).toContain("method: 'DELETE'")
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('prepare(')
    expect(route).not.toContain('INSERT INTO')
    expect(route).not.toContain('UPDATE ')
  })

  it('returns canonical request IDs and precise invalid-query errors', () => {
    const createRoute = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/contents/route.ts'),
      'utf8',
    )
    expect(route).toContain("`req_${crypto.randomUUID()}`")
    expect(createRoute).toContain("`req_${crypto.randomUUID()}`")
    expect(createRoute).toContain("'Invalid content query'")
    expect(createRoute).not.toContain("message: 'Content service unavailable', details: {} }, requestId")
  })

  it('enforces If-Match and Idempotency-Key on content mutations', () => {
    expect(route).toContain('requireMutationHeaders')
    expect(route).toContain("request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("request.headers.get('If-Match')?.trim() ?? ''")
    expect(route).toContain('idempotencyKey.length > 256')
    expect(route).toContain('ifMatch.length > 256')
    expect(route).toContain("ifMatch === '*'")
    expect(route).toContain("'PRECONDITION_REQUIRED'")
    expect(route).toContain("'PRECONDITION_FAILED'")
  })

  it('enforces Idempotency-Key on content creation', () => {
    const createRoute = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/contents/route.ts'),
      'utf8',
    )
    expect(createRoute).toContain("request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(createRoute).toContain('idempotencyKey.length > 256')
    expect(createRoute).toContain("'PRECONDITION_REQUIRED'")
    expect(createRoute).toContain('status: 428')
  })

  it('keeps public GET without mutation preconditions', () => {
    expect(route).toContain("method: 'GET'")
    expect(route).toContain('resolveOptionalCookieContentPrincipal')
  })
})
