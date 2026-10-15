import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Twitter Clone-inspired discussion tree on LuckRead APIs', () => {
  it('renders comments as parent-child nodes while keeping W05 API ownership', () => {
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    const thread = read('src/app/(frontend)/content/[contentId]/DiscussionThread.tsx')
    const tree = read('src/app/(frontend)/content/[contentId]/discussion-tree.ts')

    expect(comments).toContain("import DiscussionThread from './DiscussionThread'")
    expect(comments).toContain('<DiscussionThread')
    expect(comments).toContain('comments={comments}')
    expect(comments).toContain("'/api/v1/contents/' + encodeURIComponent(contentId) + '/comments?'")
    expect(comments).toContain('body: JSON.stringify({ body: body.trim(), parentId: replyingTo })')
    expect(thread).toContain('buildDiscussionTree(comments)')
    expect(thread).toContain('node.children.map')
    expect(thread).toContain('role="list"')
    expect(tree).toContain('parentId')
    expect(tree).toContain('Missing parents can happen at a pagination boundary')
  })

  it('keeps comment edit, delete, like and reply actions in the existing renderer', () => {
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')

    expect(comments).toContain('toggleCommentLike(comment)')
    expect(comments).toContain('deleteComment(comment)')
    expect(comments).toContain('updateComment(comment)')
    expect(comments).toContain('setReplyingTo(comment.id)')
    expect(comments).toContain("'Idempotency-Key': 'social-comment-delete:' + crypto.randomUUID()")
    expect(comments).toContain("'If-Match': '\"' + comment.updatedAt + '\"'")
  })

  it('provides responsive thread connectors and preserves reduced-motion preferences', () => {
    const styles = read('src/app/(frontend)/content/[contentId]/discussion-thread.module.css')

    expect(styles).toContain('.children')
    expect(styles).toContain('border-inline-start')
    expect(styles).toContain('@media (max-width: 560px)')
    expect(styles).toContain('prefers-reduced-motion')
  })
})
