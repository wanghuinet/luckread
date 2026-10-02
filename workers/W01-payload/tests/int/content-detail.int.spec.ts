import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public content detail', () => {
  it('renders all published video media references', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')

    expect(page).toContain('content-detail-video-gallery')
    expect(page).toContain('content.mediaRefs.map((url, index)')
    expect(page).toContain("preload={index === 0 ? 'metadata' : 'none'}")
    expect(page).toContain('poster={index === 0 ? content.coverRef || undefined : undefined}')
  })
})

  it('hydrates like state from the authenticated status API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain('/api/v1/interactions/likes?targetType=content&targetId=')
    expect(page).toContain('likeData?.data?.liked')
    expect(page).toContain('likeData?.data?.likeCount')
    expect(page).toContain('setLikeCount(')
    expect(page).toContain("toLocaleString('zh-CN')")

  })

  it('connects the content detail page to author follow state and mutations', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain('creatorId?: string | null')
    expect(page).toContain('/api/v1/social/follows/')
    expect(page).toContain('followData?.data?.following')
    expect(page).toContain('setFollowing(followData.data.following)')
    expect(page).toContain("following ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-follow:' + crypto.randomUUID()")
    expect(page).toContain('关注作者')
  })

  it('exposes reply controls using the existing parentId comment contract', () => {
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(comments).toContain("const [replyingTo, setReplyingTo] = useState<string | null>(null)")
    expect(comments).toContain('parentId: replyingTo')
    expect(comments).toContain('回复')
    expect(comments).toContain('取消回复')
    expect(comments).toContain('comment.depth < 3')
  })

  it('connects the content detail page to the authenticated like API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain("fetch('/api/v1/interactions/likes'")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("targetType: 'content'")
    expect(page).toContain("liked ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-like:' + crypto.randomUUID()")
  })


it('links published content to the public author profile when creatorId is present', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/content/[contentId]/page.tsx'), 'utf8')
  expect(page).toContain("href={'/users/' + encodeURIComponent(content.creatorId)}")
  expect(page).toContain('查看作者')
})
