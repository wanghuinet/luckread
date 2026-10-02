import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('content comments UI', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

  it('redirects expired comment submission sessions back to login', () => {
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(comments).toContain("if (response.status === 401)")
    expect(comments).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(comments).not.toContain("请先登录后发表评论。")
  })

  it('renders the comment component from the content detail page', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain("import ContentComments from './ContentComments'")
    expect(page).toContain('<ContentComments contentId={content.id} />')
  })

  it('keeps newly posted comments in the same chronological order as the public list', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('setComments((current) => [...current, created])')
    expect(component).not.toContain('setComments((current) => [created, ...current])')
  })

  it('cancels stale comment list requests when a newer load starts or the component unmounts', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('useRef<AbortController | null>(null)')
    expect(component).toContain('activeControllerRef.current?.abort()')
    expect(component).toContain('signal: controller.signal')
    expect(component).toContain('activeControllerRef.current = null')
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
