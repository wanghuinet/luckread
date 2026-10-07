import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 series adapters', () => {
  it('exposes authenticated creator series CRUD through W03', () => {
    const collection = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/series/route.ts'),
      'utf8',
    )
    const detail = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/series/[seriesId]/route.ts'),
      'utf8',
    )
    expect(collection).toContain("'/internal/content/series'")
    expect(collection).toContain('resolveContentPrincipal')
    expect(collection).toContain("request.headers.get('Idempotency-Key')")
    expect(detail).toContain("'/internal/content/series/'")
    expect(detail).toContain("request.headers.get('If-Match')")
    expect(detail).toContain("request.headers.get('Idempotency-Key')")
    expect(detail).toContain("method: 'PATCH'")
    expect(detail).toContain("method: 'DELETE'")
    expect(detail).not.toContain('content_series')
  })

  it('rejects wildcard If-Match on series mutations', () => {
    const detail = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/series/[seriesId]/route.ts'),
      'utf8',
    )
    expect(detail).toContain("ifMatch === '*'")
    expect(detail).toContain('PRECONDITION_REQUIRED')
  })
})
