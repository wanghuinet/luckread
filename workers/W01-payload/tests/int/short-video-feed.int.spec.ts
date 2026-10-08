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
    expect(feed).toContain("fetch('/api/v1/contents?' + params.toString()")
    expect(feed).toContain('page.nextCursor')
  })

  it('implements viewport-driven autoplay, pause, snap scrolling, keyboard navigation, and auto-prefetch', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    const css = read('src/app/(frontend)/shorts/short-video.module.css')
    expect(feed).toContain('IntersectionObserver')
    expect(feed).toContain('video.play()')
    expect(feed).toContain('video.pause()')
    expect(feed).toContain("event.key === 'ArrowDown'")
    expect(feed).toContain('loadMoreSentinelRef')
    expect(feed).toContain('void loadPage(nextCursor)')
    expect(feed).toContain('root: feedRef.current')
    expect(css).toContain('scroll-snap-type: y mandatory')
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
  })

  it('keeps autoplay muted by default and supports explicit sound control plus accessible controls', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const [muted, setMuted] = useState(true)')
    expect(feed).toContain('playsInline')
    expect(feed).toContain("aria-label={muted ? '打开声音' : '关闭声音'}")
    expect(feed).toContain('onDoubleClick={() => {')
    expect(feed).toContain('showDoubleTapHeart()')
    expect(feed).toContain('toggleLike(item)')
    expect(feed).toContain('onClick={() => togglePlay(item)}')
  })

  it('does not create a second media, feed, or interaction backend authority', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).not.toContain('D1Database')
    expect(feed).not.toContain('queue')
    expect(feed).not.toContain('transcod')
    expect(feed).not.toContain('new Worker')
  })
})
