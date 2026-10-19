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
    expect(feed).toContain('IntersectionObserver')
    expect(feed).toContain('video.play()')
    expect(feed).toContain('video.pause()')
    expect(feed).toContain("event.key === 'ArrowDown'")
    expect(feed).toContain("target?.closest('button, a, input, textarea, select, [contenteditable=\"true\"]')")
    expect(feed).toContain('className="relative text-[15px] font-bold text-white no-underline after:absolute')
    expect(feed).not.toContain('>为你</span>')
    expect(feed).toContain('loadMoreSentinelRef')
    expect(feed).toContain('void loadPage(nextCursor)')
    expect(feed).toContain('root: feedRef.current')
    expect(feed).toContain('snap-y snap-mandatory')
    expect(feed).toContain('touch-pan-y')
    expect(feed).toContain('select-none')
    expect(feed).toContain('[-webkit-touch-callout:none]')
    expect(feed).toContain('snap-always')
    expect(feed).toContain('h-dvh min-h-screen')
  })

  it('keeps the MVP feed deterministic without implying recommendation behavior', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).not.toContain('notInterestedIds')
    expect(feed).not.toContain('markNotInterested')
    expect(feed).not.toContain('不感兴趣')
    expect(feed).not.toContain('为你推荐')
    expect(feed).toContain('entry.intersectionRatio >= 0.75')
    expect(feed).toContain('{ threshold: [0.75] }')
    expect(feed).toContain('className="text-[15px] font-bold text-white/70 no-underline">视频列表</Link>')
    expect(feed).toContain('aria-label="发布视频"')
  })

  it('uses an accessible reason dialog instead of a browser prompt for short-video reports', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')

    expect(feed).toContain("const [reportTarget, setReportTarget] = useState<ContentItem | null>(null)")
    expect(feed).toContain('aria-modal="true"')
    expect(feed).toContain('role="dialog"')
    expect(feed).toContain("value: 'SPAM'")
    expect(feed).toContain("value: 'ABUSE'")
    expect(feed).toContain("value: 'IMPERSONATION'")
    expect(feed).toContain("value: 'COPYRIGHT'")
    expect(feed).toContain("value: 'OTHER'")
    expect(feed).toContain('setReportTarget(item)')
    expect(feed).toContain('reasonCode: reportReasonCode')
    expect(feed).not.toContain('window.prompt(')
    expect(feed).toContain('!reportTarget && playbackIntentRef.current')
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
    expect(feed).toContain('const likeData = likeResult?.data as')
    expect(feed).not.toContain('responses[0].json()')
    expect(feed).not.toContain('Promise<Response>[]')
  })

  it('keeps autoplay muted by default and supports explicit sound control plus accessible controls', () => {
    const feed = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(feed).toContain('const [muted, setMuted] = useState(true)')
    expect(feed).toContain('playsInline')
    expect(feed).toContain("aria-label={muted ? '打开声音' : '关闭声音'}")
    expect(feed).toContain('const handleVideoTap')
    expect(feed).toContain('if (event.detail >= 2)')
    expect(feed).toContain('showDoubleTapHeart(item.id)')
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
