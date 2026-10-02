import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('share landing page', () => {
  it('resolves an opaque share id and redirects to canonical content', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(frontend)/s/[shareId]/page.tsx'),
      'utf8',
    )
    expect(page).toContain('/api/v1/shares/')
    expect(page).toContain('data.data.contentId')
    expect(page).toContain("router.replace('/content/' + encodeURIComponent(data.data.contentId))")
    expect(page).toContain('cache: \'no-store\'')
    expect(page).toContain("import Link from 'next/link'")
    expect(page).toContain('<Link href="/content">去发现内容</Link>')
  })
})
