import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public creator profile', () => {
  it('renders the responsive creator profile surface without exposing private profile fields', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    const route = read('src/app/api/v1/users/[userId]/route.ts')

    expect(page).toContain('creator-profile-shell')
    expect(page).toContain('creator-profile-sidebar')
    expect(page).toContain('creator-profile-mobile-header')
    expect(page).toContain('creator-profile-hero')
    expect(page).toContain('creator-profile-actions')
    expect(page).toContain('creator-profile-circle-button')
    expect(page).toContain('creator-profile-overflow-menu')
    expect(page).toContain('aria-label="私信"')
    expect(page).toContain('aria-label="更多操作"')
    expect(page).toContain('creator-profile-circle-actions')
    expect(page).toContain("profile?.bio?.trim() ? profile.bio : '尚无个人简介'")
    expect(page).not.toContain('creator-profile-actions .creator-profile-circle-button')
    expect(page).not.toContain('LUCKREAD CREATOR')
    expect(page).not.toContain('creator-profile-secondary-actions')
    expect(page).toContain('creator-profile-tabs')
    expect(page).toContain('creator-profile-grid')
    expect(page).toContain('creator-profile-card')
    expect(route).toContain("collection: 'users'")
    expect(route).toContain('overrideAccess: true')
    expect(route).toContain("username: typeof publicUser.username === 'string' ? publicUser.username : ''")
    expect(route).toContain("displayName: typeof publicUser.displayName === 'string' ? publicUser.displayName : null")
    expect(route).toContain("bio: typeof publicUser.bio === 'string' ? publicUser.bio : null")
    expect(route).toContain("avatar: typeof publicUser.avatar === 'string' ? publicUser.avatar : null")
    expect(route).not.toContain('email: true')
    expect(route).not.toContain('locale: true')
    expect(route).not.toContain('timezone: true')
  })

  it('preserves the full return path when follow authentication expires', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain("const returnTo = window.location.pathname + window.location.search + window.location.hash")
    expect(page).toContain("router.replace('/login?returnTo=' + encodeURIComponent(returnTo))")
  })

  it('keeps follow, block, mute and report on canonical interaction adapters', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    const reportRoute = read('src/app/api/v1/reports/route.ts')
    const socialClient = read('src/social/w05-social-client.ts')

    expect(page).toContain('/api/v1/social/follows/')
    expect(page).toContain("method: isFollowing ? 'DELETE' : 'POST'")
    expect(page).toContain("'Idempotency-Key': 'social-follow:' + crypto.randomUUID()")
    expect(page).toContain('/followers?limit=1')
    expect(page).toContain('/following?limit=1')
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("applySafetyAction('block')")
    expect(page).toContain("applySafetyAction('mute')")
    expect(page).toContain("const relationPath = action === 'block' ? 'blocks' : 'mutes'")
    expect(page).toContain("'/api/v1/interactions/' + relationPath")
    expect(page).toContain("body: JSON.stringify({ targetUserId: profile.id })")
    expect(page).toContain("'Idempotency-Key': 'social-' + action + ':' + (active ? 'remove:' : 'set:') + crypto.randomUUID()")
    expect(page).toContain('reportProfile()')
    expect(page).toContain("targetType: 'profile'")
    expect(page).toContain("targetId: profile.id")
    expect(page).toContain("'Idempotency-Key': 'report:profile:' + profile.id + ':' + crypto.randomUUID()")
    expect(reportRoute).toContain("targetType === 'creator' || targetType === 'profile'")
    expect(socialClient).toContain("collection: 'users'")
    expect(socialClient).toContain('overrideAccess: true')
  })

  it('uses bounded creator content reads and keeps type filtering cache-compatible', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    const cache = read('src/lib/public-response-cache.ts')

    expect(page).toContain('/api/v1/contents?')
    expect(page).toContain('creatorId=')
    expect(page).toContain('limit=6')
    expect(page).toContain("params.set('type', filter)")
    expect(page).toContain('loadMoreContents')
    expect(page).toContain('cursor: contentCursor')
    expect(page).toContain("const [filter, setFilter] = useState<ProfileFilter>('all')")
    expect(cache).toContain("'content-list': ['creatorId', 'cursor', 'limit', 'type']")
  })

  it('invalidates stale public-profile content requests on navigation', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain('const contentRequestRef = useRef<AbortController | null>(null)')
    expect(page).toContain('const contentRequestIdRef = useRef(0)')
    expect(page).toContain('contentRequestIdRef.current += 1')
    expect(page).toContain('contentRequestRef.current?.abort()')
    expect(page).toContain('signal: controller.signal')
  })

  it('uses real public thumbnails without inline image background URLs', () => {
    const page = read('src/app/(frontend)/users/[userId]/page.tsx')
    expect(page).toContain('src={item.coverRef}')
    expect(page).toContain('height={360}')
    expect(page).toContain('width={480}')
    expect(page).not.toContain("backgroundImage: 'linear-gradient(135deg")
    expect(page).not.toContain('style={{')
  })
})
