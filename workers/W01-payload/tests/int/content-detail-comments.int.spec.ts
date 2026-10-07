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

  it('renders the comment component from the interactive content detail client', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("import ContentComments from './ContentComments'")
    expect(page).toContain('<ContentComments')
    expect(page).toContain('contentId={content.id}')
    expect(page).toContain('viewerUserId={viewerUserId}')
  })

  it('keeps newly posted comments in the same chronological order as the public list', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('setComments((current) => [...current, created])')
    expect(component).not.toContain('setComments((current) => [created, ...current])')
  })

  it('connects each comment to the canonical like status and mutation APIs', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('/api/v1/interactions/likes?targetType=comment&targetId=')
    expect(component).toContain('/api/v1/comments/')
    expect(component).toContain('/likes')
    expect(component).toContain("'Idempotency-Key': 'social-comment-like:' + crypto.randomUUID()")
    expect(component).toContain('likedComments[comment.id]')
  })

  it('reuses the content detail viewer identity instead of requesting /users/me again', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('viewerUserId: string | null')
    expect(component).not.toContain("/api/v1/users/me")
  })

  it('exposes author-only comment editing with an If-Match version guard', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain("const [editingId, setEditingId] = useState<string | null>(null)")
    expect(component).toContain("method: 'PATCH'")
    expect(component).toContain(`'If-Match': '"' + comment.updatedAt + '"'`)
    expect(component).toContain("'Idempotency-Key': 'social-comment-update:' + crypto.randomUUID()")
    expect(component).toContain('comment.authorUserId === viewerUserId')
    expect(component).toContain('copy.comments.save')
  })

  it('exposes author-only comment deletion with the canonical delete API', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain("method: 'DELETE'")
    expect(component).toContain('deleteComment(comment)')
    expect(component).toContain("'Idempotency-Key': 'social-comment-delete:' + crypto.randomUUID()")
    expect(component).toContain('copy.comments.tooManyReplies')
  })

  it('cancels stale comment list requests before applying responses', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('useRef, useState')
    expect(component).toContain('commentsRequestRef')
    expect(component).toContain('commentsRequestIdRef')
    expect(component).toContain('commentsRequestRef.current?.abort()')
    expect(component).toContain('const controller = new AbortController()')
    expect(component).toContain('signal: controller.signal')
    expect(component).toContain("error.name === 'AbortError'")
    expect(component).toContain('if (requestId !== commentsRequestIdRef.current) return')
  })

  it('uses the public comments read and authenticated create APIs', () => {
    const component = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(component).toContain('/api/v1/contents/')
    expect(component).toContain('/comments?')
    expect(component).toContain("method: 'POST'")
    expect(component).toContain("credentials: 'include'")
    expect(component).toContain("'Idempotency-Key': idempotencyKey")
    expect(component).toContain("href={'/users/' + encodeURIComponent(comment.authorUserId)}")
    expect(component).toContain('copy.comments.profile')
  })
})
