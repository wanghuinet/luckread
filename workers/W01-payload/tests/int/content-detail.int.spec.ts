import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public content detail', () => {
  it('renders all published video media references', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(page).toContain('content-detail-video-gallery')
    expect(page).toContain('content.mediaRefs.map((url, index)')
    expect(page).toContain("preload={index === 0 ? 'metadata' : 'none'}")
    expect(page).toContain('poster={index === 0 ? content.coverRef || undefined : undefined}')
  })
})

  it('hydrates like state from the authenticated status API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain('/api/v1/interactions/likes?targetType=content&targetId=')
    expect(page).toContain('likeData?.data?.liked')
    expect(page).toContain('likeData?.data?.likeCount')
    expect(page).toContain('setLikeCount(')
    expect(page).toContain('toLocaleString(dateLocale')

  })

  it('hydrates favorite state from the authenticated status API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain('/api/v1/interactions/bookmarks?targetType=content&targetId=')
    expect(page).toContain('bookmarkData?.data?.favorited')
    expect(page).toContain('setBookmarked(bookmarkData.data.favorited)')
    expect(page).toContain("bookmarked ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-bookmark:' + crypto.randomUUID()")
    expect(page).toContain('copy.detail.favorite')
  })

  it('surfaces normalized mention and hashtag tokens without creating a second taxonomy authority', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("extractSocialTokens(body)")
    expect(page).toContain('copy.detail.tagAria')
    expect(page).toContain('content-detail-social-token')
    expect(page).not.toContain('hashtags/resolve')
    expect(page).not.toContain('classification_edge')
  })

  it('connects the content detail page to the canonical report API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("fetch('/api/v1/reports'")
    expect(page).toContain("targetType: 'content'")
    expect(page).toContain('targetId: content.id')
    expect(page).toContain('reasonCode')
    expect(page).toContain('reportBusy')
    expect(page).toContain('copy.detail.report')
    expect(page).not.toContain('moderation_reports')
    expect(page).not.toContain('audit_events')
  })

  it('uses the share-token API to generate a copyable content share link', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain('/api/v1/content/' )
    expect(page).toContain("'Idempotency-Key': 'social-share:' + crypto.randomUUID()")
    expect(page).toContain("window.location.origin + '/s/' + encodeURIComponent(shareId)")
    expect(page).toContain("typeof navigator.share === 'function'")
    expect(page).toContain("await navigator.share({ title: content.title, url: shareUrl })")
    expect(page).toContain("shareError.name === 'AbortError'")
    expect(page).toContain('await navigator.clipboard.writeText(shareUrl)')
    expect(page).toContain('copy.detail.copied')
  })

  it('hides self-follow on the viewer own content', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("fetch('/api/v1/users/me'")
    expect(page).toContain("setViewerUserId(typeof viewerData?.id === 'string' ? viewerData.id : null)")
    expect(page).toContain('viewerUserId === content.creatorId')
    expect(page).toContain('copy.detail.own')
  })

  it('connects the content detail page to author follow state and mutations', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain('creatorId?: string | null')
    expect(page).toContain('/api/v1/social/follows/')
    expect(page).toContain('followData?.data?.following')
    expect(page).toContain('relationship?.blocked')
    expect(page).toContain('relationship?.blockedBy')
    expect(page).toContain('setFollowRestricted')
    expect(page).toContain("following ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-follow:' + crypto.randomUUID()")
    expect(page).toContain('copy.detail.follow')
  })

  it('exposes reply controls using the existing parentId comment contract', () => {
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(comments).toContain("const [replyingTo, setReplyingTo] = useState<string | null>(null)")
    expect(comments).toContain('parentId: replyingTo')
    expect(comments).toContain('copy.comments.reply')
    expect(comments).toContain('copy.comments.cancelReply')
    expect(comments).toContain('comment.depth < 3')
  })

  it('redirects expired like and follow sessions back to login', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("const returnTo = window.location.pathname + window.location.search + window.location.hash")
    expect(page).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(page).not.toContain("请先登录后点赞。")
    expect(page).not.toContain("请先登录后关注作者。")
  })

  it('passes Block restriction into the comment interaction UI', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')
    expect(page).toContain('interactionRestricted={interactionRestricted}')
    expect(comments).toContain('interactionRestricted = false')
    expect(comments).toContain('copy.comments.restricted')
    expect(comments).toContain('{!interactionRestricted ? (')
    expect(comments).toContain('{!interactionRestricted && comment.depth < 3 ? (')
  })

  it('hides like when the content relationship is blocked', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain('interactionRestricted')
    expect(page).toContain('setInteractionRestricted(blocked || blockedBy)')
    expect(page).toContain('{!interactionRestricted ? (')
  })

  it('connects the content detail page to the authenticated like API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("fetch('/api/v1/interactions/likes'")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("targetType: 'content'")
    expect(page).toContain("liked ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-like:' + crypto.randomUUID()")
  })


it('links published content to the public author profile when creatorId is present', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx'), 'utf8')
  expect(page).toContain("href={'/users/' + encodeURIComponent(content.creatorId)}")
  expect(page).toContain('copy.detail.author')
})

it('cancels stale public profile content pagination requests', () => {
  const page = read('src/app/(frontend)/users/[userId]/page.tsx')
  expect(page).toContain('contentRequestRef')
  expect(page).toContain('contentRequestIdRef')
  expect(page).toContain('contentRequestRef.current?.abort()')
  expect(page).toContain('const controller = new AbortController()')
  expect(page).toContain('signal: controller.signal')
  expect(page).toContain("cause.name === 'AbortError'")
  expect(page).toContain('if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return')
})

it('keeps arbitrary cookies from bypassing the public content cache', () => {
  const route = read('src/app/api/v1/contents/[contentId]/route.ts')
  expect(route).toContain('resolveOptionalCookieContentPrincipal')
  expect(route).toContain('if (!hasAuthenticatedSessionCredential(request)) {')
  expect(route).not.toContain("!request.headers.get('Authorization') && !request.headers.get('cookie')")
})


it('uses a server-side canonical metadata wrapper for public content', () => {
  const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
  expect(page).toContain('generateMetadata')
  expect(page).toContain('alternates:')
  expect(page).toContain('cachedPublicGet')
  expect(page).toContain('permanentRedirect')
  expect(page).toContain("PUBLIC_ORIGIN = 'https://luckread.com'")
})

it('keeps interactive content requests anonymous so signed-in browsers can use the shared cache', () => {
  const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
  expect(page).toContain("credentials: 'omit'")
  expect(page).toContain("headers: { accept: 'application/json' }")
  expect(page).toContain("cache: 'no-store'")
})
