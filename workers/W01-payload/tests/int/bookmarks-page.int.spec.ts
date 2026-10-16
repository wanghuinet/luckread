import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('bookmarks page on the reused LuckRead content UI', () => {
  const page = read('src/app/(frontend)/bookmarks/page.tsx')
  const postCard = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
  const contentBrowse = read('src/app/(frontend)/content/page.tsx')
  const home = read('src/app/(frontend)/page.tsx')

  it('loads private, cursor-paginated bookmarks through the canonical W01 endpoint', () => {
    expect(page).toContain("'/api/v1/interactions/bookmarks?'")
    expect(page).toContain("new URLSearchParams({ list: 'true', limit: '18' })")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("cache: 'no-store'")
    expect(page).toContain("params.set('cursor', cursor)")
    expect(page).toContain("response.status === 401")
    expect(page).toContain("'/login?returnTo=' + encodeURIComponent(returnTo)")
    expect(page).not.toContain('firebase/firestore')
    expect(page).not.toContain('tweetsCollection')
  })

  it('uses the reused social post card and existing article/video card primitives', () => {
    expect(page).toContain("import LuckReadSocialPostCard from '../components/reuse/LuckReadSocialPostCard'")
    expect(page).toContain('<LuckReadSocialPostCard')
    expect(page).toContain('<ArticleSummaryPreview')
    expect(page).toContain('<video')
    expect(page).toContain('content-feed-card-skeleton')
    expect(page).toContain('content-browse-grid')
    expect(page).not.toContain('bookmarks.module.css')
    expect(page).not.toContain('styles.css')
    expect(contentBrowse).toContain('<Link className="button button-quiet" data-umami-event="bookmarks-open" href="/bookmarks">')
    expect(home).toContain('data-umami-event="bookmarks-open"')
  })

  it('removes saved items through the idempotent bookmark API and updates the visible list', () => {
    expect(page).toContain("method: 'DELETE'")
    expect(page).toContain("'/api/v1/interactions/bookmarks'")
    expect(page).toContain("targetType: 'content', targetId: item.id")
    expect(page).toContain("'Idempotency-Key': 'luckread-bookmark-list-remove:' + crypto.randomUUID()")
    expect(page).toContain('removeFromPage(item.id)')
  })

  it('removes a post after its own bookmark action succeeds, without duplicating bookmark controls', () => {
    expect(postCard).toContain('onBookmarkChanged?: (bookmarked: boolean) => void')
    expect(postCard).toContain('onBookmarkChanged?.(!previousBookmarked)')
    expect(page).toContain('onBookmarkChanged={(bookmarked) => {')
    expect(page).toContain('if (!bookmarked) removeFromPage(item.id)')
  })
})
