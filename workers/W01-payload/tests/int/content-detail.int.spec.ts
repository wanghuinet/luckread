import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public content detail', () => {
  it('renders all published video media references', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(page).toContain('className="grid gap-1"')
    expect(page).toContain('block max-h-[720px] w-full bg-black object-cover')
    expect(page).toContain('content.mediaRefs.map((url, index)')
    expect(page).toContain("preload={index === 0 ? 'metadata' : 'none'}")
    expect(page).toContain('poster={index === 0 ? content.coverRef || undefined : undefined}')
  })
})

  it('hydrates like and favorite state from one canonical W05 social summary', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain('/api/v1/contents/')
    expect(page).toContain("encodeURIComponent(resolved.id) + '/social'")
    expect(page).toContain('summary.counts?.likes')
    expect(page).toContain('summary.viewer?.liked')
    expect(page).toContain('summary.viewer?.favorited')
    expect(page).toContain('setLikeCount(')
    expect(page).toContain("bookmarked ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-bookmark:' + crypto.randomUUID()")
    expect(page).toContain('toLocaleString(dateLocale')
  })

  it('renders persisted W05 mentions and topics instead of maintaining a second content taxonomy', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain('socialTopics')
    expect(page).toContain('socialMentions')
    expect(page).toContain("href={'/topics/' + encodeURIComponent(topic.name)}")
    expect(page).toContain("href={'/users/' + encodeURIComponent(mention.userId)}")
    expect(page).toContain('<SocialMentionText text={paragraph} mentions={socialMentions}')
    expect(page).not.toContain("href={'/users/' + encodeURIComponent(mention.handle)}")
    expect(page).toContain('copy.detail.tagAria')
    expect(page).toContain('main-tab rounded-full border border-light-border px-3 py-1.5 text-sm text-main-accent')
    expect(page).not.toContain('extractSocialTokens(socialTokenBody)')
    expect(page).not.toContain('hashtags/resolve')
    expect(page).not.toContain('classification_edge')
  })

  it('uses an accessible reason dialog instead of a native prompt for content reports', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("const [reportDialogOpen, setReportDialogOpen] = useState(false)")
    expect(page).toContain('aria-modal="true"')
    expect(page).toContain('role="dialog"')
    expect(page).toContain("value: 'SPAM'")
    expect(page).toContain("value: 'ABUSE'")
    expect(page).toContain("value: 'IMPERSONATION'")
    expect(page).toContain("value: 'COPYRIGHT'")
    expect(page).toContain("value: 'OTHER'")
    expect(page).toContain("setReportDialogOpen(true)")
    expect(page).toContain('reasonCode: reportReasonCode')
    expect(page).not.toContain('window.prompt(')
  })

  it('connects the content detail page to the canonical report API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    expect(page).toContain("fetchJson<{ data?: { status?: string }; error?: { message?: string } }>('/api/v1/reports'")
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
    expect(page).toContain("fetchJson<{ id?: string }>('/api/v1/users/me'")
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
    expect(page).toContain("fetchJson<{ error?: { message?: string } }>('/api/v1/interactions/likes'")
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
  const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
  expect(page).toContain('contentRequestRef')
  expect(page).toContain('contentRequestIdRef')
  expect(page).toContain('contentRequestRef.current?.abort()')
  expect(page).toContain('const controller = new AbortController()')
  expect(page).toContain('signal: controller.signal')
  expect(page).toContain("cause.name === 'AbortError'")
  expect(page).toContain('if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return')
})

it('keeps arbitrary cookies from bypassing the public content cache', () => {
  const reader = read('src/content/public-content-detail-reader.ts')
  expect(reader).toContain('resolveOptionalCookieContentPrincipal')
  expect(reader).toContain('if (!hasAuthenticatedSessionCredential(request)) {')
  expect(reader).not.toContain("!request.headers.get('Authorization') && !request.headers.get('cookie')")
})


it('uses in-process W01 readers for server-rendered public content and author data', () => {
  const page = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
  const routes = read('src/app/(frontend)/content/PublicContentRoutes.tsx')
  const contentReader = read('src/content/public-content-detail-reader.ts')
  const userReader = read('src/users/public-user-profile-reader.ts')
  expect(page).toContain('generateMetadata')
  expect(page).toContain('generateLegacyContentMetadata(contentId)')
  expect(page).toContain('renderLegacyContentRoute(contentId)')
  expect(routes).toContain('getPublicContentDetailResponse(')
  expect(routes).toContain('getPublicUserProfileResponse(')
  expect(routes).toContain("if (response.status === 404) return null")
  expect(routes).toContain("throw new Error('PUBLIC_CONTENT_READ_FAILED:' + response.status)")
  expect(routes).toContain("throw new Error('PUBLIC_AUTHOR_READ_FAILED:' + response.status)")
  expect(routes).toContain('alternates: { canonical:')
  expect(routes).toContain('permanentRedirect(canonicalPath(author, content))')
  expect(routes).toContain('showLanguageToggle={false}')
  expect(routes).not.toContain('fetchJson')
  expect(routes).not.toContain('api.luckread.com')
  expect(contentReader).toContain('callW03Content')
  expect(contentReader).toContain('W03_CONTENT')
  expect(userReader).toContain('getPayload({ config })')
  expect(userReader).toContain("throw error")
  expect(contentReader).not.toContain('globalThis.fetch')
  expect(userReader).not.toContain('globalThis.fetch')
})

it('keeps interactive content requests anonymous so signed-in browsers can use the shared cache', () => {
  const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
  expect(page).toContain("credentials: 'omit'")
  expect(page).toContain("headers: { accept: 'application/json' }")
  expect(page).toContain("cache: 'no-store'")
})


it('renders versioned structured article bodies instead of flattening them to paragraphs', () => {
  const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
  const renderer = read('src/components/ArticleStructuredRenderer.tsx')

  expect(page).toContain("tryDeserializeArticleDocument(body)")
  expect(page).toContain('ArticleStructuredRenderer')
  expect(page).toContain('<ArticleStructuredRenderer document={structuredArticle} mentions={socialMentions} />')
  expect(page).toContain('!structuredArticle')
  expect(renderer).toContain("block.type === 'heading'")
  expect(renderer).toContain("block.type === 'bulletList' || block.type === 'orderedList'")
  expect(renderer).toContain("block.type === 'gallery'")
  expect(renderer).toContain('content-detail-article-gallery')
  expect(renderer).toContain('<SocialMentionText text={block.text} mentions={mentions}')
  expect(renderer).toContain('<SocialMentionText text={item} mentions={mentions}')
})

it('keeps legacy plain-text article bodies on the backward-compatible renderer', () => {
  const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
  expect(page).toContain('splitBodyIntoParagraphs(body)')
  expect(page).toContain('whitespace-pre-wrap break-words text-[15px] leading-6 text-light-primary dark:text-dark-primary')
})


it('handles the follow DELETE no-body response without attempting JSON parsing', () => {
  const page = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
  expect(page).toContain('if (following) {')
  expect(page).toContain('setFollowing(false)')
  expect(page).toContain("fetchJson<{ data?: { following?: boolean }; error?: { message?: string } }>")
})


it('retries a missing UUID-backed stable slug through W01 content detail by content ID', () => {
  const routes = read('src/app/(frontend)/content/PublicContentRoutes.tsx')
  expect(routes).toContain('const uuidFromStableContentSlug = (slug: string): string | null =>')
  expect(routes).toContain("const compactUuid = /-([0-9a-f]{32})$/i.exec(slug)?.[1]")
  expect(routes).toContain('if (!content && response.status === 404)')
  expect(routes).toContain('const fallbackId = uuidFromStableContentSlug(contentId)')
  expect(routes).toContain('response = await fetchContentById(fallbackId, headersForRequest)')
  expect(routes).toContain("new Request('https://luckread.com/api/v1/contents/'")
})
