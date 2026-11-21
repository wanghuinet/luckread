import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Umami content navigation event reuse', () => {
  it('uses the native tracker events on the homepage navigation actions', () => {
    const home = read('src/app/(twitter-clone)/TwitterCloneLanding.tsx')
    expect(home).toContain('data-umami-event="creator-center-open"')
    expect(home).toContain('data-umami-event="content-discovery-open"')
    expect(home).toContain('data-umami-event="short-video-discovery-open"')
    expect(home).not.toContain('umami.track(')
  })

  it('uses the active timeline and shared social-card tracker for homepage content', () => {
    const feed = read('src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx')
    const card = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    expect(feed).toContain('LuckReadSocialPostCard')
    expect(feed).toContain('presentation="x-timeline"')
    expect(card).toContain('data-umami-event="content-open"')
    expect(card).not.toContain('umami.track(')
    expect(card).not.toContain('data-umami-event-content-id')
    expect(card).not.toContain('data-umami-event-title')
  })

  it('reuses the upstream data-attribute tracker for the public discovery list', () => {
    const page = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    expect(page).toContain('data-umami-event="content-open"')
    expect(page).toContain('data-umami-event-content-type={item.contentType}')
    expect(page).not.toContain('umami.track(')
    expect(page).not.toContain('data-umami-event-content-id')
    expect(page).not.toContain('data-umami-event-title')
  })

  it('tracks short-video detail and navigation clicks without sending content identifiers or titles', () => {
    const shorts = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')
    expect(shorts).toContain('data-umami-event="content-open"')
    expect(shorts).toContain('data-umami-event-content-type="video"')
    expect(shorts).toContain('data-umami-event="content-discovery-open"')
    expect(shorts).toContain('data-umami-event="creator-center-open"')
    expect(shorts).not.toContain('data-umami-event-content-id')
    expect(shorts).not.toContain('data-umami-event-title')
    expect(shorts).not.toContain('umami.track(')
  })

  it('loads the tracker once from the shared frontend root layout', () => {
    const layout = read('src/app/(twitter-clone)/layout.tsx')
    const tracker = read('src/app/(frontend)/UmamiAnalytics.tsx')
    expect(layout).toContain("import UmamiAnalytics from '../(frontend)/UmamiAnalytics'")
    expect(layout).toContain('<UmamiAnalytics />')
    expect(tracker).toContain('data-do-not-track="true"')
    expect(tracker).toContain('data-exclude-search="true"')
    expect(tracker).toContain('data-exclude-hash="true"')
  })
})
