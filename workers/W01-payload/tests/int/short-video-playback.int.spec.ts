import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('short video playback polish', () => {
  it('scopes double-tap heart feedback to the tapped video', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const [doubleTapHeartId, setDoubleTapHeartId] = useState<string | null>(null)')
    expect(feed).toContain('showDoubleTapHeart(item.id)')
    expect(feed).toContain('doubleTapHeartId === item.id')
    expect(feed).toContain('setDoubleTapHeartId(null)')
    expect(feed).not.toContain('const [doubleTapHeart, setDoubleTapHeart] = useState(false)')
  })

  it('supports double-tap like feedback and active-video progress', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('showDoubleTapHeart')
    expect(feed).toContain('const handleVideoTap')
    expect(feed).toContain('if (event.detail >= 2)')
    expect(feed).toContain('setActiveProgress(0)')
    expect(feed).toContain('setActiveIndex(index)')
    expect(feed).toContain('onTimeUpdate')
    expect(feed).toContain('current.duration > 0')
    expect(feed).toContain('animate-ping motion-reduce:animate-none')
    expect(feed).toContain('origin-left bg-white transition-[width] duration-150')
    expect(feed).not.toContain('short-video.module.css')
  })

  it('does not turn scroll events into high-frequency React state updates', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).not.toContain('onScroll={() => setActiveProgress(0)}')
    expect(feed).not.toContain("useEffect(() => {\n    setActiveProgress(0)\n  }, [activeIndex])")
    expect(feed).toContain('setActiveProgress(0)')
    expect(feed).toContain('loadMoreSentinelRef')
    expect(feed).toContain('root: feedRef.current')
  })

  it('pauses background playback and resumes only the active video when foregrounded', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)")
    expect(feed).toContain("document.visibilityState === 'hidden'")
    expect(feed).toContain('Object.values(videoRefs.current).forEach((video) => video?.pause())')
    expect(feed).toContain('const activeVideo = visibleItems[activeIndexRef.current]?.id')
    expect(feed).toContain("document.removeEventListener('visibilitychange', handleVisibilityChange)")
  })

  it('preserves user pause state across page visibility changes', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const resumeAfterVisibilityRef = useRef(false)')
    expect(feed).toContain('resumeAfterVisibilityRef.current = Boolean(video && !video.paused && !video.ended)')
    expect(feed).toContain('if (commentsOpen || !resumeAfterVisibilityRef.current)')
    expect(feed).toContain('resumeAfterVisibilityRef.current = false')
    expect(feed).toContain("mediaErrorById[id] || document.visibilityState === 'hidden'")
    expect(feed).toContain('const playbackIntentRef = useRef(true)')
    expect(feed).toContain('playbackIntentRef.current = true')
    expect(feed).toContain('playbackIntentRef.current = false')
    expect(feed).toContain('const resumeAfterCommentsRef = useRef(false)')
    expect(feed).toContain('resumeAfterCommentsRef.current = Boolean(video && !video.paused && !video.ended)')
    expect(feed).toContain('const closeComments = () => {')
  })

  it('shows paused feedback for the active short video', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const [playingById, setPlayingById]')
    expect(feed).toContain('onPlay={() => {')
    expect(feed).toContain('onPause={() => {')
    expect(feed).toContain('z-[6] grid h-[72px] w-[72px]')
    expect(feed).toContain('fa-play')
    expect(feed).not.toContain('controls={true}')
    expect(feed).not.toContain('short-video.module.css')
  })

  it('shows an explicit buffering state for slow short-video playback', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const [bufferingById, setBufferingById]')
    expect(feed).toContain('onWaiting={() => {')
    expect(feed).toContain('onCanPlay={() => {')
    expect(feed).toContain('onPlaying={() => {')
    expect(feed).toContain('z-[7] inline-flex')
    expect(feed).toContain('animate-spin rounded-full border-2')
    expect(feed).toContain("视频加载中…")
    expect(feed).not.toContain('short-video.module.css')
  })

  it('separates single-tap playback from double-tap like gestures', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const singleTapTimerRef = useRef<number | null>(null)')
    expect(feed).toContain('const handleVideoTap = (item: ContentItem, event: MouseEvent<HTMLVideoElement>) =>')
    expect(feed).toContain('onClick={(event) => handleVideoTap(item, event)}')
    expect(feed).toContain('if (event.detail >= 2) {')
    expect(feed).toContain('window.clearTimeout(singleTapTimerRef.current)')
    expect(feed).toContain('togglePlay(item)')
    expect(feed).toContain('showDoubleTapHeart(item.id)')
    expect(feed).not.toContain('onDoubleClick={() =>')
  })

  it('exposes a recoverable media error path without changing the feed authority', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const [mediaErrorById, setMediaErrorById]')
    expect(feed).toContain('onError={(event) => {')
    expect(feed).toContain('setMediaErrorById((current) => ({ ...current, [item.id]: true }))')
    expect(feed).toContain('const retryPlayback = (item: ContentItem) =>')
    expect(feed).toContain('video.load()')
    expect(feed).toContain('grid w-[min(360px,calc(100%-40px))]')
    expect(feed).toContain('min-h-9 cursor-pointer rounded-full border-0 bg-white')
  })

  it('keeps optional interaction state independent when one bootstrap request fails', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('Promise.allSettled(requests)')
    expect(feed).toContain('fulfilledResult')
    expect(feed).toContain('const likeResult = fulfilledResult(0)')
    expect(feed).toContain('const bookmarkResult = fulfilledResult(1)')
    expect(feed).toContain('const followResult = followIndex >= 0 ? fulfilledResult(followIndex) : null')
  })

  it('supports accessible comment dismissal with Escape', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('event.key === \'Escape\'')
    expect(feed).toContain('handleCommentsKeyDown')
    expect(feed).toContain('window.addEventListener(\'keydown\', handleCommentsKeyDown)')
    expect(feed).toContain('closeComments()')
  })

  it('polishes mobile comments and controls around safe-area insets', () => {
    expect(feed).toContain('max-[640px]:bottom-[calc(75px+env(safe-area-inset-bottom))]')
    expect(feed).toContain('max-[640px]:bottom-[calc(76px+env(safe-area-inset-bottom))]')
    expect(feed).toContain('max-[640px]:h-[78dvh]')
    expect(feed).toContain('max-[640px]:rounded-t-[18px]')
    expect(feed).toContain('max-[640px]:pb-[max(10px,env(safe-area-inset-bottom))]')
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
    expect(feed).not.toContain('markNotInterested')
    expect(feed).toContain('report(item)')
    expect(feed).toContain('snap-y snap-mandatory')
  })

  it('keeps the short-video route discoverable from the homepage', () => {
    const page = read('src/app/(twitter-clone)/TwitterCloneLanding.tsx')
    expect(page).toContain('href="/shorts"')
  })
})
