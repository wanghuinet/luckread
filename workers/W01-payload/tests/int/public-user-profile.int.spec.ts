import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public creator profile', () => {
  it('renders the responsive creator profile surface without exposing private profile fields', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    const route = read('src/app/api/v1/users/[userId]/route.ts')
    const profileHeader = read('src/app/(frontend)/users/[userId]/TwitterCloneProfileHeader.tsx')
    const profileNav = read('src/app/(frontend)/users/[userId]/TwitterCloneProfileNav.tsx')

    expect(page).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={name} active="profile">')
    expect(page).not.toContain('creator-profile-shell')
    expect(page).not.toContain('creator-profile-sidebar')
    expect(page).not.toContain('creator-profile-mobile-header')
    expect(page).toContain('href="/me/profile"')
    expect(profileHeader).toContain('h-36 bg-light-line-reply xs:h-48 sm:h-52')
    expect(page).toContain('flex flex-wrap items-center justify-end gap-2')
    expect(page).toContain('main-tab grid h-10 w-10')
    expect(page).toContain('absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-36')
    expect(page).toContain('aria-label="私信"')
    expect(page).toContain('aria-label="更多操作"')
    expect(page).toContain("void shareProfile()")
    expect(page).toContain('role="menuitem"')
    expect(page).not.toContain('aria-label="分享主页"')
    expect(page).toContain('aria-label="快捷操作"')
    expect(profileHeader).toContain('profile.bio?.trim() ? profile.bio : <span')
    expect(page).toContain("setFollowers(typeof followerData?.data?.totalCount === 'number' ? followerData.data.totalCount : 0)")
    expect(page).toContain("setFollowing(typeof followingData?.data?.totalCount === 'number' ? followingData.data.totalCount : 0)")
    expect(page).not.toContain('PUBLIC WORKS')
    expect(page).not.toContain('正在加载作品…')
    expect(page).toContain('暂无回复或讨论')
    expect(page).not.toContain('creator-profile-actions .creator-profile-circle-button')
    expect(page).not.toContain('LUCKREAD CREATOR')
    expect(page).not.toContain('creator-profile-secondary-actions')
    expect(page).not.toContain("type ProfileFilter = 'all' | PublicContent['contentType']")
    expect(page).toContain("const [filter, setFilter] = useState<ProfileChannel>('posts')")
    expect(page).toContain("if (filter === 'posts') query.set('type', 'post')")
    expect(page).toContain("if (filter === 'articles') query.set('type', 'article')")
    expect(page).toContain("posts: '帖子'")
    expect(page).not.toContain("post: '动态'")
    expect(page).toContain("article: '文章'")
    expect(page).toContain("video: '视频'")
    expect(page).not.toContain("<h2 id=\"creator-profile-works-title\">")
    expect(profileNav).toContain('main-tab dark-bg-tab')
    expect(page).not.toContain('creator-profile-grid')
    expect(page).toContain("posts: '帖子',\n  replies: '回复',\n  media: '媒体',\n  likes: '点赞',\n  articles: '文章'")
    expect(page).not.toContain('creator-profile-card')
    expect(route).toContain("collection: 'users'")
    expect(route).toContain('overrideAccess: true')
    expect(route).toContain("username: typeof publicUser.username === 'string' ? publicUser.username : ''")
    expect(route).toContain("identityId: typeof publicUser.identityId === 'string' ? publicUser.identityId : null")
    expect(route).toContain("displayName: typeof publicUser.displayName === 'string' ? publicUser.displayName : null")
    expect(route).toContain("bio: typeof publicUser.bio === 'string' ? publicUser.bio : null")
    expect(route).toContain("avatar: typeof publicUser.avatar === 'string' ? publicUser.avatar : null")
    expect(route).not.toContain('email: true')
    expect(route).not.toContain('locale: true')
    expect(route).not.toContain('timezone: true')
  })

  it('preserves the full return path when follow authentication expires', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    expect(page).toContain("const returnTo = window.location.pathname + window.location.search + window.location.hash")
    expect(page).toContain("router.replace('/login?returnTo=' + encodeURIComponent(returnTo))")
  })

  it('keeps follow, block, mute and report on canonical interaction adapters', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    const reportRoute = read('src/app/api/v1/reports/route.ts')
    const socialClient = read('src/social/w05-social-client.ts')

    expect(page).toContain('/api/v1/social/follows/')
    expect(page).toContain('encodeURIComponent(profile.identityId || profile.id)')
    expect(page).toContain("method: isFollowing ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-follow:' + crypto.randomUUID()")
    expect(page).toContain('/followers?limit=1')
    expect(page).toContain('/following?limit=1')
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("applySafetyAction('block')")
    expect(page).toContain("applySafetyAction('mute')")
    expect(page).toContain("const relationPath = action === 'block' ? 'blocks' : 'mutes'")
    expect(page).toContain("'/api/v1/interactions/' + relationPath")
    expect(page).toContain("body: JSON.stringify({ targetUserId: profile.identityId || profile.id })")
    expect(page).toContain("'Idempotency-Key': 'social-' + action + ':' + (active ? 'remove:' : 'set:') + crypto.randomUUID()")
    expect(page).toContain('reportProfile()')
    expect(page).toContain("targetType: 'profile'")
    expect(page).toContain("targetId: profile.identityId || profile.id")
    expect(page).toContain("'Idempotency-Key': 'report:profile:' + (profile.identityId || profile.id) + ':' + crypto.randomUUID()")
    expect(reportRoute).toContain("targetType === 'creator' || targetType === 'profile'")
    expect(socialClient).toContain("collection: 'users'")
    expect(socialClient).toContain('overrideAccess: true')
  })

  it('uses bounded creator content reads and keeps type filtering cache-compatible', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    const cache = read('src/lib/public-response-cache.ts')

    expect(page).toContain('/api/v1/contents?')
    expect(page).toContain('creatorId=')
    expect(page).toContain("'creatorId=' + encodeURIComponent(profile.identityId || profile.id)")
    expect(page).toContain("const canonicalProfileId = typeof data.identityId === 'string' && data.identityId.trim()")
    expect(page).toContain("'/api/v1/contents?creatorId=' + encodeURIComponent(canonicalProfileId) + '&limit=6&type=post'")
    expect(page).not.toContain("'/api/v1/contents?creatorId=' + encodeURIComponent(userId)")
    expect(page).not.toContain("'creatorId=' + encodeURIComponent(profile.id)")
    expect(page).toContain('creatorId: profile.identityId || profile.id')
    expect(page).not.toContain('creatorId: profile.id,')
    expect(page).toContain('limit=6')
    expect(page).toContain("credentials: 'omit'")
    expect(page).toContain("if (filter === 'posts') query.set('type', 'post')")
    expect(page).toContain("if (filter === 'articles') query.set('type', 'article')")
    expect(page).toContain('loadMoreContents')
    expect(page).toContain('cursor: contentCursor')
    expect(page).toContain("const [filter, setFilter] = useState<ProfileChannel>('posts')")
    expect(cache).toContain("'content-list': ['creatorId', 'cursor', 'limit', 'type']")
  })

  it('invalidates stale public-profile content requests on navigation', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    expect(page).toContain('const contentRequestRef = useRef<AbortController | null>(null)')
    expect(page).toContain('const contentRequestIdRef = useRef(0)')
    expect(page).toContain('contentRequestIdRef.current += 1')
    expect(page).toContain('contentRequestRef.current?.abort()')
    expect(page).toContain('signal: controller.signal')
  })

  it('reuses the Twitter Clone social post card for dynamic items on public profiles', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    const card = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')

    expect(page).toContain("import LuckReadSocialPostCard from '../../components/reuse/LuckReadSocialPostCard'")
    expect(page).toContain("if (item.contentType === 'post')")
    expect(page).toContain('<LuckReadSocialPostCard')
    expect(page).toContain('presentation="x-timeline"')
    expect(page).toContain('creatorId={item.creatorId ?? (profile?.identityId || profile?.id)}')
    expect(page).not.toContain('creatorId={item.creatorId ?? profile?.id}')
    expect(page).toContain('mediaRefs={item.mediaRefs}')
    expect(page).toContain('createdAt={item.createdAt}')
    expect(page).toContain('href={getContentHref(item)}')
    expect(card).toContain("'/api/v1/contents/' + encodeURIComponent(contentId) + '/social'")
    expect(card).toContain('/api/v1/interactions/likes')
  })

  it('adapts Twitter Clone share/bookmark actions to LuckRead interaction APIs', () => {
    const card = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(card).toContain("'/api/v1/interactions/bookmarks'")
    expect(card).toContain("'/api/v1/content/' + encodeURIComponent(contentId) + '/shares'")
    expect(card).toContain("summary?.viewer?.favorited === true")
    expect(card).toContain('className="content-detail-like"')
    expect(card).toContain('className="content-detail-share"')
    expect(card).toContain("window.location.origin + '/s/' + encodeURIComponent(shareId)")
    expect(card).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(card).not.toContain('firebase')
    expect(detail).toContain("'/api/v1/interactions/bookmarks'")
    expect(detail).toContain("'/api/v1/content/' + encodeURIComponent(content.id) + '/shares'")
  })



  it('connects post, reply, media, likes, and article profile channels to canonical read APIs', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    const nav = read('src/app/(frontend)/users/[userId]/TwitterCloneProfileNav.tsx')

    expect(nav).toContain("'posts' | 'replies' | 'media' | 'likes' | 'articles'")
    expect(page).toContain("'/api/v1/users/' + encodeURIComponent(profile.identityId || profile.id) + '/replies?limit=6'")
    expect(page).toContain("'/api/v1/users/' + encodeURIComponent(profile.identityId || profile.id) + '/likes?limit=6'")
    expect(page).toContain('loadLikedContentDetails')
    expect(page).toContain("data.data.items.filter(isMediaContent)")
    expect(page).toContain("setReplies((current) => [...current, ...data.data.items])")
    expect(page).toContain('return buildPublicContentHref({')
    expect(page).toContain('authorUsername: profile?.username')
  })

  it('routes profile works through the canonical content detail route', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    expect(page).toContain('return buildPublicContentHref({')
    expect(page).toContain('authorUsername: profile?.username')
    expect(page).not.toContain("return '/' + encodeURIComponent(profile!.username) + '/' + item.contentType + '/' + encodeURIComponent(item.id)")
  })

  it('uses real public thumbnails without inline image background URLs', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
    expect(page).toContain('src={item.coverRef}')
    expect(page).toContain('height={360}')
    expect(page).toContain('width={480}')
    expect(page).not.toContain("backgroundImage: 'linear-gradient(135deg")
    expect(page).not.toContain('style={{')
  })
})


  it('localizes the profile-report reason dialog in English, Traditional Chinese, and Simplified Chinese', () => {
    const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')

    expect(page).toContain("locale === 'en' ? 'Report user' : locale === 'tw' ? '檢舉使用者' : '举报用户'")
    expect(page).toContain("locale === 'en' ? 'Choose the reason that best describes this account.' : locale === 'tw' ? '請選擇最符合此帳號情況的檢舉原因。' : '请选择最符合此账号情况的举报原因。'")
    expect(page).toContain("locale === 'en' ? 'Abuse or harassment' : locale === 'tw' ? '騷擾或辱罵' : '骚扰或辱骂'")
    expect(page).toContain("locale === 'en' ? 'Spam or unwanted promotion' : locale === 'tw' ? '垃圾訊息或廣告' : '垃圾信息或广告'")
    expect(page).toContain("locale === 'en' ? 'Copyright infringement' : locale === 'tw' ? '侵犯版權' : '侵犯版权'")
    expect(page).toContain("reportBusy ? (locale === 'en' ? 'Submitting…' : '提交中…') : locale === 'en' ? 'Submit report' : locale === 'tw' ? '提交檢舉' : '提交举报'")
  })


it('handles the profile follow DELETE no-body response without requiring a JSON payload', () => {
  const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
  expect(page).toContain('if (isFollowing) {')
  expect(page).toContain('setIsFollowing(false)')
  expect(page).toContain('setFollowers((value) => value === null ? value : Math.max(0, value - 1))')
  expect(page).toContain('const { response, data } = await fetchJson<{ data?: { following?: boolean }; error?: { message?: string } }>')
})


it('keeps public follower and following pages anonymous for shared-cache delivery', () => {
  const page = read('src/app/(frontend)/users/[userId]/UserFollowList.tsx')
  expect(page).toContain("credentials: 'omit'")
  expect(page).toContain("cache: 'no-store'")
  expect(page).toContain("'/api/v1/users/' + encodeURIComponent(userId) + '/' + direction + '?' + params.toString()")
  expect(page).toContain("fetchJson<ProfileResponse>('/api/v1/users/' + encodeURIComponent(userId)")
  expect(page).toContain("fetchJson<ListResponse>('/api/v1/users/' + encodeURIComponent(userId) + '/' + direction")
  expect(page).not.toContain("fetch('/api/v1/users/' + encodeURIComponent(userId)")
})


it('resolves public profile projections by Better Auth identity id without exposing the mapping field', () => {
  const route = read('src/app/api/v1/users/by-identity-id/[identityId]/route.ts')

  expect(route).toContain("where: { identityId: { equals: identityId } }")
  expect(route).toContain("collection: 'users'")
  expect(route).toContain("username: typeof publicUser.username === 'string' ? publicUser.username : ''")
  expect(route).toContain("displayName: typeof publicUser.displayName === 'string' ? publicUser.displayName : null")
  expect(route).toContain("avatar: typeof publicUser.avatar === 'string' ? publicUser.avatar : null")
  expect(route).toContain("cachedPublicGet(")
  expect(route).not.toContain("identityId: String(publicUser.identityId")
})



describe('username-resolved public profile API contract', () => {
  it('declares the existing anonymous lookup route across API sources and generated alignment', () => {
    const route = read('src/app/api/v1/users/by-username/[username]/route.ts')
    const page = read('src/app/(twitter-clone)/[username]/page.tsx')
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const inventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json')) as { domains: Record<string, { endpoint_groups: string[] }> }
    const alignment = JSON.parse(read('../../contracts/alignment/api-inventory.v1.json')) as { records: Array<{ operationId: string; method: string; path: string; status: string }> }
    const operationPolicy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json')) as { operations: Array<{ operationId: string; auth: { mode: string }; permissions: string[] }> }

    expect(route).toContain('const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/')
    expect(route).toContain("cache-control': 'public, max-age=30, stale-while-revalidate=120'")
    expect(route).toContain("bio: typeof publicUser.bio === 'string' ? publicUser.bio : null")
    expect(route).not.toContain('email: true')
    expect(page).toContain("const normalizedUsername = username.trim().replace(/^@+/, '')")
    expect(page).toContain("fetchJson<PublicUserLookup>('/api/v1/users/by-username/' + encodeURIComponent(normalizedUsername)")
    expect(openapi).toContain('  /users/by-username/{username}:')
    expect(openapi).toContain('operationId: getUsersByUsernameUsername')
    expect(openapi).toContain('public, max-age=30, stale-while-revalidate=120')
    expect(openapi).toContain("displayName: { type: [string, 'null'] }")
    expect(openapi).toContain("avatar: { type: [string, 'null'] }")
    expect(inventory.domains.users_accounts.endpoint_groups).toContain('GET /v1/users/by-username/{username}')
    expect(alignment.records.some((record) => record.operationId === 'getUsersByUsernameUsername' && record.method === 'GET' && record.path === '/v1/users/by-username/{username}')).toBe(true)
    expect(alignment.records.find((record) => record.operationId === 'getUsersByUsernameUsername')?.status).toBe('DISCOVERED')
    expect(operationPolicy.operations.find((operation) => operation.operationId === 'getUsersByUsernameUsername')).toMatchObject({
      auth: { mode: 'public' },
      permissions: ['user.read.public'],
    })
  })
})


it('keeps public-profile posts and replies in full-width vertical lists', () => {
  const page = read('src/app/(frontend)/users/[userId]/UserProfilePage.tsx')
  const styles = read('src/app/(frontend)/styles.css')

  expect(page).toContain('<section className="min-w-0 w-full" id="works"')
  expect(page).toContain('className="flex min-w-0 flex-col"')
  expect(page).toContain('border-b border-light-border px-4 py-3 transition-colors')
  expect(page).not.toContain('creator-profile-grid')
  expect(page).not.toContain('creator-profile-post-list')
  expect(page).not.toContain('creator-profile-reply-list')
  expect(page).not.toContain('creator-profile-card')
  expect(styles).not.toContain('.creator-profile-works')
  expect(styles).not.toContain('.creator-profile-card')
})
