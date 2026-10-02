import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('content comments UI', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

  it('renders the comment component from the content detail page', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain("import ContentComments from './ContentComments'")
    expect(page).toContain('<ContentComments contentId={content.id} />')
  })

  it('uses the public comments read and authenticated create APIs', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('/api/v1/contents/')
    expect(component).toContain('/comments?')
    expect(component).toContain("method: 'POST'")
    expect(component).toContain("credentials: 'include'")
    expect(component).toContain("'Idempotency-Key': idempotencyKey")
    expect(component).toContain("href={'/users/' + encodeURIComponent(comment.authorUserId)}")
    expect(component).toContain('查看主页')
  })
})
