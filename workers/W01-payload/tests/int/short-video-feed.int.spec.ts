import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('TikTok-style short video feed', () => {
  it('loads only public video content through the existing cached content API', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain("type: 'video'")
    expect(feed).toContain("limit: '12'")
    expect(feed).toContain("credentials: 'omit'")
    expect(feed).toContain("fetchJson<ApiResponse<ContentPage>>('/api/v1/contents?' + params.toString()")
    expect(feed).toContain('page.nextCursor')
  })

  it('implements viewport-driven autoplay, pause, snap scrolling, keyboard navigation, and auto-prefetch', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    const css = read('src/app/(frontend)/shorts/short-video.module.css')
    expect(feed).toContain('IntersectionObserver')
    expect(feed).toContain('video.play()')
    expect(feed).toContain('video.pause()')
    expect(feed).toContain("event.key === 'ArrowDown'")
    expect(feed).toContain("target?.closest('button, a, input, textarea, select, [contenteditable=\"true\"]')")
    expect(feed).toContain('<span className={styles.feedTabActive}>短视频</span>')
    expect(feed).not.toContain('<span className={styles.feedTabActive}>为你</span>')
        expect(feed).toContain('loadMoreSentinelRef')
    expect(feed).toContain('void loadPage(nextCursor)')
    expect(feed).toContain('root: feedRef.current')
    expect(css).toContain('scroll-snap-type: y mandatory')
    expect(css).toContain('touch-action: pan-y')
    expect(css).toContain('user-select: none')
    expect(css).toContain('-webkit-touch-callout: none')
    expect(css).toContain('scroll-snap-stop: always')
    expect(css).toContain('height: 100dvh')
  })

  it('reuses canonical like, bookmark, follow, share, report, and comment authorities', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('/api/v1/interactions/likes')
    expect(feed).toContain('/api/v1/interactions/bookmarks')
    expect(feed).toContain('/api/v1/social/follows/')
    expect(feed).toContain('/api/v1/content/')
    expect(feed).toContain('/api/v1/reports')
    expect(feed).toContain("import ContentComments from '../content/[contentId]/ContentComments'")
    expect(feed).toContain("targetType: 'content'")
    expect(feed).toContain("'Idempotency-Key': 'short-video-like:' + crypto.randomUUID()")
    expect(feed).toContain("fetchJson<ApiResponse<{ liked?: boolean; likeCount?: number }>>('/api/v1/interactions/likes?targetType=content&targetId=' + encodeURIComponent(active.id)")
    expect(feed).toContain('const likeData = responses[0].data as')
    expect(feed).not.toContain('responses[0].json()')
  })

  it('keeps autoplay muted by default and supports explicit sound control plus accessible controls', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const [muted, setMuted] = useState(true)')
    expect(feed).toContain('playsInline')
    expect(feed).toContain("aria-label={muted ? '打开声音' : '关闭声音'}")
    expect(feed).toContain('const handleVideoTap')
    expect(feed).toContain('if (event.detail >= 2)')
    expect(feed).toContain('showDoubleTapHeart()')
    expect(feed).toContain('toggleLike(item)')
    expect(feed).toContain('onClick={(event) => handleVideoTap(item, event)}')
    expect(feed).not.toContain('onDoubleClick={() =>')
  })

  it('preloads the active video and the next two videos while keeping older videos lightweight', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain("index === activeIndex ? 'auto'")
    expect(feed).toContain("index > activeIndex && index <= activeIndex + 2 ? 'auto'")
    expect(feed).toContain("index === activeIndex - 1 ? 'metadata'")
    expect(feed).toContain("'none'")
  })

  it('does not create a second media, feed, or interaction backend authority', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).not.toContain('D1Database')
    expect(feed).not.toContain('queue')
    expect(feed).not.toContain('transcod')
    expect(feed).not.toContain('new Worker')
  })
})


describe('short video creator profile routing', () => {
  it('prefers the canonical username profile route and keeps an id fallback while profile data loads', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const creatorHref = item.creatorId')
    expect(feed).toContain("const creatorUsername = item.creatorId ? profileById[item.creatorId]?.username : null")
    expect(feed).toContain("creatorUsername ? '/' + encodeURIComponent(creatorUsername)")
    expect(feed).toContain("'/users/' + encodeURIComponent(item.creatorId)")
    expect(feed).toContain('href={creatorHref}')
  })
})
