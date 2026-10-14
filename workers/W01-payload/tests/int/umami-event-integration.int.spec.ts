import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Umami content navigation event reuse', () => {
  it('reuses the upstream data-attribute tracker for homepage content cards', () => {
    const feed = read('src/app/(frontend)/HomeContentFeed.tsx')
    expect(feed).toContain('data-umami-event="content-open"')
    expect(feed).toContain('data-umami-event-content-type={item.contentType}')
    expect(feed).not.toContain('umami.track(')
    expect(feed).not.toContain('data-umami-event-content-id')
    expect(feed).not.toContain('data-umami-event-title')
  })

  it('reuses the upstream data-attribute tracker for the public discovery list', () => {
    const page = read('src/app/(frontend)/content/page.tsx')
    expect(page).toContain('data-umami-event="content-open"')
    expect(page).toContain('data-umami-event-content-type={item.contentType}')
    expect(page).not.toContain('umami.track(')
    expect(page).not.toContain('data-umami-event-content-id')
    expect(page).not.toContain('data-umami-event-title')
  })

  it('loads the tracker once from the shared frontend root layout', () => {
    const layout = read('src/app/(frontend)/layout.tsx')
    const tracker = read('src/app/(frontend)/UmamiAnalytics.tsx')
    expect(layout).toContain("import UmamiAnalytics from './UmamiAnalytics'")
    expect(layout).toContain('<UmamiAnalytics />')
    expect(tracker).toContain('data-do-not-track="true"')
    expect(tracker).toContain('data-exclude-search="true"')
    expect(tracker).toContain('data-exclude-hash="true"')
  })
})
