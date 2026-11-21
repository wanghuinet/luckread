import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isVideoMediaRef, resolveSocialPostMedia } from '../../src/lib/social-post-media.js'
import { createTtlPromiseCache } from '../../src/lib/social-post-profile-cache.js'

describe('Twitter Clone UI reuse through LuckRead API adapters', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

  it('ports the Tweet-style post card without importing the upstream Firebase backend', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const sharedStyles = read('src/app/(frontend)/styles.css')
    const notice = read('src/app/(frontend)/components/reuse/THIRD_PARTY_NOTICES.md')

    expect(component).toContain('Tweet, TweetStats and user')
    expect(component).toContain("'/api/v1/contents/' + encodeURIComponent(contentId) + '/social'")
    expect(component).toContain('/api/v1/interactions/likes')
    expect(component).toContain("const reportContent = async () =>")
    expect(component).toContain("'/api/v1/reports'")
    expect(component).toContain("targetType: 'content', targetId: contentId, reasonCode: reportReasonCode")
    expect(component).toContain("'Idempotency-Key': 'twitter-clone-reuse-report:content:' + contentId + ':' + crypto.randomUUID()")
    expect(component).toContain("'Idempotency-Key': 'twitter-clone-reuse-like:' + crypto.randomUUID()")
    expect(component).toContain("JSON.stringify({ targetType: 'content', targetId: contentId })")
    expect(component).toContain('getCachedPublicProfile(authorId)')
    const profileCache = read('src/lib/social-post-profile-cache.ts')
    expect(profileCache).toContain("'/api/v1/users/' + encodeURIComponent(normalizedId)")
    expect(profileCache).toContain("'/api/v1/users/by-identity-id/' + encodeURIComponent(normalizedId)")
    expect(profileCache).toContain('identityId')
    expect(profileCache).toContain("credentials: 'omit'")
    expect(profileCache).toContain('ttlMs: 30_000')
    expect(profileCache).toContain('maxEntries: 200')
    expect(component).not.toContain('firebase/firestore')
    expect(component).not.toContain('tweetsCollection')
    expect(notice).toContain('Copyright (c) 2022 ccrsxx')
    expect(notice).toContain('MIT License')
    expect(component).not.toContain('LuckReadSocialPostCard.module.css')
    expect(() => read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.module.css')).toThrow()
    expect(sharedStyles).toContain('.content-feed-card {')
    expect(sharedStyles).toContain('.content-feed-cover img,')
    expect(sharedStyles).toContain('.content-detail-actions {')
    expect(sharedStyles).toContain('.content-detail-like')
    expect(component).toContain('className="content-detail-actions"')
    expect(component).toContain('className="content-comment-reply"')
    expect(component).toContain('className="content-detail-like"')
    expect(component).toContain('className="content-detail-follow"')
  })

  it('uses an accessible reason dialog instead of a browser prompt for social post reports', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')

    expect(component).toContain("const [reportDialogOpen, setReportDialogOpen] = useState(false)")
    expect(component).toContain('aria-modal="true"')
    expect(component).toContain('role="dialog"')
    expect(component).toContain("value: 'ABUSE'")
    expect(component).toContain("value: 'SPAM'")
    expect(component).toContain("value: 'IMPERSONATION'")
    expect(component).toContain("value: 'COPYRIGHT'")
    expect(component).toContain("value: 'OTHER'")
    expect(component).toContain("setReportDialogOpen(true)")
    expect(component).toContain("reasonCode: reportReasonCode")
    expect(component).not.toContain('window.prompt(')
  })

  it('uses the reusable social post card in both homepage and discovery for dynamic content', () => {
    const contentBrowse = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    const homeFeed = read('src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx')

    for (const page of [contentBrowse]) {
      expect(page).toContain("import LuckReadSocialPostCard from")
      expect(page).toContain("item.contentType === 'post'")
      expect(page).toContain('<LuckReadSocialPostCard')
      expect(page).toContain('creatorId={item.creatorId}')
      expect(page).toContain('author={item.creator ?? item.author}')
      expect(page).toContain('mediaRefs={item.mediaRefs}')
      expect(page).toContain('locale={locale}')
    }
    expect(homeFeed).toContain('LuckReadSocialPostCard')
    expect(homeFeed).toContain('presentation="x-timeline"')
  })

  it('renders bounded, de-duplicated photo and video attachments in the post card', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const sharedStyles = read('src/app/(frontend)/styles.css')

    const media = resolveSocialPostMedia([
      'https://media.luckread.com/a.jpg',
      'https://media.luckread.com/a.jpg',
      'https://media.luckread.com/b.webp',
      'https://media.luckread.com/clip.MP4?token=1',
      'https://media.luckread.com/c.png',
      'https://media.luckread.com/overflow.jpg',
    ], 'https://media.luckread.com/poster.jpg')

    expect(media).toHaveLength(4)
    expect(media.map((item) => item.src)).toEqual([
      'https://media.luckread.com/a.jpg',
      'https://media.luckread.com/b.webp',
      'https://media.luckread.com/clip.MP4?token=1',
      'https://media.luckread.com/c.png',
    ])
    expect(media.map((item) => item.kind)).toEqual(['image', 'image', 'video', 'image'])
    expect(media[2]?.poster).toBe('https://media.luckread.com/poster.jpg')
    expect(isVideoMediaRef('/uploads/clip.webm?download=1')).toBe(true)
    expect(isVideoMediaRef('/uploads/photo.jpg')).toBe(false)
    expect(resolveSocialPostMedia([], 'https://media.luckread.com/cover.png')).toEqual([
      { src: 'https://media.luckread.com/cover.png', kind: 'image' },
    ])

    expect(component).toContain('resolveSocialPostMedia(mediaRefs, coverRef)')
    expect(component).toContain('media.kind === \'video\'')
    expect(component).toContain('preload="metadata"')
    expect(component).toContain('mediaItems.length === 1')
    expect(component).toContain('className="content-feed-cover"')
    expect(component).toContain('className="lr-preview-media"')
    expect(sharedStyles).toContain('.content-feed-cover img,')
    expect(sharedStyles).toContain('.lr-preview-media img,')
    expect(() => read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.module.css')).toThrow()
  })

  it('keeps like mutations on LuckRead W01/W05 authority and redirects unauthenticated users to login', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')

    expect(component).toContain("method: previousLiked ? 'DELETE' : 'POST'")
    expect(component).toContain("if (response.status === 401)")
    expect(component).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(component).toContain("targetType: 'content'")
    expect(component).toContain("href={contentHref}")
  })

  it('coalesces concurrent author lookups, caches successful values briefly, and retries failures', async () => {
    let now = 0
    const cache = createTtlPromiseCache<string, { id: string }>({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    })
    let calls = 0
    const loader = async () => {
      calls += 1
      return { id: 'author-1' }
    }

    const [first, concurrent] = await Promise.all([
      cache.get('author-1', loader),
      cache.get('author-1', loader),
    ])
    expect(calls).toBe(1)
    expect(first).toBe(concurrent)

    now = 99
    await cache.get('author-1', loader)
    expect(calls).toBe(1)

    now = 101
    await cache.get('author-1', loader)
    expect(calls).toBe(2)

    let failedCalls = 0
    await expect(cache.get('unavailable', async () => {
      failedCalls += 1
      throw new Error('temporary failure')
    })).rejects.toThrow('temporary failure')
    await expect(cache.get('unavailable', async () => {
      failedCalls += 1
      return { id: 'recovered' }
    })).resolves.toEqual({ id: 'recovered' })
    expect(failedCalls).toBe(2)
    expect(cache.size).toBeGreaterThan(0)
  })

  it('keeps viewer-specific like summaries outside the shared public profile cache', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const cache = read('src/lib/social-post-profile-cache.ts')

    expect(component).toContain("'/api/v1/contents/' + encodeURIComponent(contentId) + '/social'")
    expect(component).toContain("credentials: 'include'")
    expect(component).toContain('getCachedPublicProfile(authorId)')
    expect(cache).not.toContain('/api/v1/contents/')
    expect(cache).not.toContain('/api/v1/interactions/likes')
  })
  it('keeps more-actions mutations on existing LuckRead APIs and reuses existing CSS primitives', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const sharedStyles = read('src/app/(frontend)/styles.css')

    expect(component).toContain("aria-haspopup=\"true\"")
    expect(component).toContain("aria-expanded={moreOpen}")
    expect(component).toContain("'/api/v1/social/follows/' + encodeURIComponent(resolvedCreatorId)")
    expect(component).toContain("method: wasFollowing ? 'DELETE' : 'POST'")
    expect(component).toContain("'Idempotency-Key': 'twitter-clone-reuse-follow:' + contentId + ':' + crypto.randomUUID()")
    expect(component).toContain("'/api/creator/contents/' + encodeURIComponent(contentId) + '/state'")
    expect(component).toContain("window.location.assign('/publish?draft=' + encodeURIComponent(contentId) + '&version=' + draftVersion)")
    expect(component).toContain("'/api/v1/contents/' + encodeURIComponent(contentId)")
    expect(component).toContain("method: 'DELETE'")
    expect(component).toContain("'If-Match': contentEtag")
    expect(component).toContain("'/api/v1/reports'")
    expect(component).toContain("targetType: 'content', targetId: contentId, reasonCode: reportReasonCode")
    expect(component).toContain("window.dispatchEvent(new Event('luckread:content-mutated'))")
    expect(component).toContain("'/api/v1/content/' + encodeURIComponent(contentId) + '/reposts'")
    expect(component).toContain("'/api/v1/content/' + encodeURIComponent(contentId) + '/pin'")
    expect(component).toContain('const toggleProfilePin = async () =>')
    expect(component).toContain("onPinChanged?.(contentId, nextPinned)")
    expect(component).toContain('Pin to profile')
    expect(component).not.toContain('LuckReadSocialPostCard.module.css')
    expect(sharedStyles).toContain('.content-detail-actions {')
    expect(sharedStyles).toContain('.content-detail-like')
  })

  it('does not expose edit/delete to non-owners and hides follow controls for blocked relationships', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    expect(component).toContain('const isOwnPost = Boolean(viewerUserId && resolvedCreatorId && viewerUserId === resolvedCreatorId)')
    expect(component).toContain('const canManagePost = Boolean(')
    expect(component).toContain('{canManagePost ? (')
    expect(component).toContain('resolvedCreatorId && !isOwnPost && !followRestricted')
    expect(component).toContain('relationship?.blocked === true || relationship?.blockedBy === true')
    expect(component).toContain("if (!canManagePost || !contentEtag || ownerActionBusy) return")
    expect(component).toContain("contentState === 'PUBLISHED'")
  })


  it('renders the authorized X-style timeline layout on the social homepage while keeping LuckRead API authority', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const homeFeed = read('src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx')

    expect(homeFeed).toContain('presentation="x-timeline"')
    expect(homeFeed).toContain('author={item.creator ?? item.author}')
    expect(component).toContain("presentation?: 'content' | 'x-timeline'")
    expect(component).toContain("const profileName = profile?.displayName?.trim() || profile?.username || ''")
    expect(component).toContain("const username = profile?.username ? '@' + profile.username : ''")
    expect(component).toContain("const profileHref = profile?.username ? '/@' + encodeURIComponent(profile.username) : null")
    expect(component).toContain("const authorHref = profileHref")
    expect(component).not.toContain('LuckRead creator')
    expect(component).not.toContain('LuckRead 创作者')
    expect(component).not.toContain("href={'/users/' + encodeURIComponent(resolvedCreatorId)}")
    expect(component).toContain("if (presentation === 'x-timeline')")
    expect(component).toContain('grid grid-cols-[auto,minmax(0,1fr)]')
    expect(component).toContain('hover:bg-black/[0.025]')
    expect(component).toContain('dark:hover:bg-white/[0.03]')
    expect(component).toContain('aria-pressed={reposted}')
    expect(component).toContain('aria-pressed={liked}')
    expect(component).toContain('aria-pressed={bookmarked}')
    expect(component).toContain('role="menu"')
    expect(component).toContain("'/api/v1/content/' + encodeURIComponent(contentId) + '/reposts'")
    expect(component).toContain("'/api/v1/content/' + encodeURIComponent(contentId) + '/pin'")
    expect(component).toContain("'/api/v1/reports'")
    expect(component).not.toContain('firebase/firestore')
    expect(component).not.toContain('tweetsCollection')
  })

})
