import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isVideoMediaRef, resolveSocialPostMedia } from '../../src/lib/social-post-media.js'

describe('Twitter Clone UI reuse through LuckRead API adapters', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

  it('ports the Tweet-style post card without importing the upstream Firebase backend', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const styles = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.module.css')
    const notice = read('src/app/(frontend)/components/reuse/THIRD_PARTY_NOTICES.md')

    expect(component).toContain('Tweet, TweetStats and user')
    expect(component).toContain("'/api/v1/contents/' + encodeURIComponent(contentId) + '/social'")
    expect(component).toContain('/api/v1/interactions/likes')
    expect(component).toContain("'Idempotency-Key': 'twitter-clone-reuse-like:' + crypto.randomUUID()")
    expect(component).toContain("JSON.stringify({ targetType: 'content', targetId: contentId })")
    expect(component).toContain('/api/v1/users/')
    expect(component).not.toContain('firebase/firestore')
    expect(component).not.toContain('tweetsCollection')
    expect(styles).toContain('@media (max-width: 560px)')
    expect(styles).toContain('prefers-reduced-motion')
    expect(notice).toContain('Copyright (c) 2022 ccrsxx')
    expect(notice).toContain('MIT License')
  })

  it('uses the reusable social post card in both homepage and discovery for dynamic content', () => {
    const homeFeed = read('src/app/(frontend)/HomeContentFeed.tsx')
    const contentBrowse = read('src/app/(frontend)/content/page.tsx')

    for (const page of [homeFeed, contentBrowse]) {
      expect(page).toContain("import LuckReadSocialPostCard from")
      expect(page).toContain("item.contentType === 'post'")
      expect(page).toContain('<LuckReadSocialPostCard')
      expect(page).toContain('creatorId={item.creatorId}')
      expect(page).toContain('mediaRefs={item.mediaRefs}')
      expect(page).toContain('locale={locale}')
    }
  })

  it('renders bounded, de-duplicated photo and video attachments in the post card', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const styles = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.module.css')

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
    expect(component).toContain('data-count={mediaItems.length}')
    expect(styles).toContain('.mediaGrid[data-count=\'3\']')
    expect(styles).toContain('.mediaGrid[data-count=\'4\']')
    expect(styles).toContain('@media (max-width: 560px)')
  })

  it('keeps like mutations on LuckRead W01/W05 authority and redirects unauthenticated users to login', () => {
    const component = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')

    expect(component).toContain("method: previousLiked ? 'DELETE' : 'POST'")
    expect(component).toContain("if (response.status === 401)")
    expect(component).toContain("window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))")
    expect(component).toContain("targetType: 'content'")
    expect(component).toContain("href={contentHref}")
  })
})
