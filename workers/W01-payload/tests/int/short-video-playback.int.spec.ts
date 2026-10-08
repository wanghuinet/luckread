import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('short video playback polish', () => {
  it('supports double-tap like feedback and active-video progress', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    const css = read('src/app/(frontend)/shorts/short-video.module.css')
    expect(feed).toContain('showDoubleTapHeart')
    expect(feed).toContain('onDoubleClick={() => {')
    expect(feed).toContain('setActiveProgress(0)')
    expect(feed).toContain('onTimeUpdate')
    expect(feed).toContain('current.duration > 0')
    expect(feed).toContain('styles.heartBurst')
    expect(feed).toContain('styles.progressTrack')
    expect(css).toContain('.heartBurst')
    expect(css).toContain('@keyframes heart-pop')
    expect(css).toContain('.progressTrack')
    expect(css).toContain('.progressValue')
  })

  it('does not turn scroll events into high-frequency React state updates', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).not.toContain('onScroll={() => setActiveProgress(0)}')
    expect(feed).toContain("useEffect(() => {\n    setActiveProgress(0)\n  }, [activeIndex])")
  })

  it('keeps the simple TikTok-style social rail and swipe flow intact', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('短视频')
    expect(feed).toContain('上下滑动继续刷视频。')
    expect(feed).toContain('toggleFollow')
    expect(feed).toContain('toggleLike')
    expect(feed).toContain('toggleComments')
    expect(feed).toContain('toggleBookmark')
    expect(feed).toContain('share(item)')
    expect(feed).toContain('markNotInterested')
    expect(feed).toContain('report(item)')
    expect(feed).toContain('scroll-snap-type: y mandatory')
  })

  it('keeps the short-video route discoverable from the homepage', () => {
    const page = read('src/app/(frontend)/page.tsx')
    expect(page).toContain('href="/shorts"')
  })
})
