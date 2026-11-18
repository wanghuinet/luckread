import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('content liker list adapter and UI', () => {
  it('keeps public likes reads rate-limited and on the W01-to-W05 boundary', () => {
    const route = read('src/app/api/v1/contents/[contentId]/likes/route.ts')
    expect(route).toContain('enforcePublicReadRateLimit(request)')
    expect(route).toContain('resolveOptionalCookieSocialPrincipal(request)')
    expect(route).toContain('callW05SocialPublic')
    expect(route).toContain("pathname: '/internal/social/content/' + encodeURIComponent(contentId) + '/likes' + suffix")
    expect(route).toContain('cursors.length > 1')
    expect(route).toContain('limits.length > 1')
    expect(route).not.toContain('interaction_likes')
    expect(route).not.toContain('env.DB')
  })

  it('uses the Neon PostgreSQL content-liker query with stable pagination and Block filters', () => {
    const runtime = read('../W05-social/src/like-list-runtime.ts')
    const storePort = read('../W05-social/src/like-list-read-store.ts')
    const postgresStore = read('../W05-social/src/like-list-read-store-postgres.ts')
    expect(runtime).toContain("contentContext.state !== 'PUBLISHED'")
    expect(runtime).toContain("contentContext.contentId !== contentId")
    expect(runtime).toContain('parsed.contentId !== contentId')
    expect(runtime).toContain('parsed.viewerUserId !== viewerUserId')
    expect(runtime).toContain('store.list(')
    expect(runtime).not.toContain('D1Database')
    expect(runtime).not.toContain('createD1ContentLikerReadStore')
    expect(storePort).not.toContain('createD1ContentLikerReadStore')
    expect(storePort).not.toContain('D1QueryExecutor')

    expect(postgresStore).toContain('interaction_likes il')
    expect(postgresStore).toContain("il.target_type = 'content'")
    expect(postgresStore.toLowerCase()).not.toContain('join contents')
    expect(postgresStore.toLowerCase()).not.toContain('from contents')
    expect(postgresStore).toContain("content_block.relation_type = 'block'")
    expect(postgresStore).toContain("viewer_block.relation_type = 'block'")
    expect(postgresStore).toContain("liker_block.relation_type = 'block'")
    expect(postgresStore).toContain('ORDER BY il.created_at DESC, il.relationship_id DESC')
    expect(postgresStore).toContain('LIMIT 

  it('opens a responsive liked-by dialog from the count without replacing like/unlike', () => {
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const modal = read('src/app/(frontend)/content/[contentId]/ContentLikesModal.tsx')
    expect(detail).toContain('onClick={() => setLikesOpen(true)}')
    expect(detail).toContain('onClick={() => void toggleLike()}')
    expect(detail).toContain('<ContentLikesModal')
    expect(modal).toContain('aria-modal="true"')
    expect(modal).toContain('aria-labelledby="content-likes-title"')
    expect(modal).toContain("limit: '20'")
    expect(modal).toContain('cursor: nextCursor')
    expect(modal).toContain('TwitterCloneFollowRow')
    expect(modal).toContain('requestControllerRef.current?.abort()')
  })
})
)
  })

  it('opens a responsive liked-by dialog from the count without replacing like/unlike', () => {
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const modal = read('src/app/(frontend)/content/[contentId]/ContentLikesModal.tsx')
    expect(detail).toContain('onClick={() => setLikesOpen(true)}')
    expect(detail).toContain('onClick={() => void toggleLike()}')
    expect(detail).toContain('<ContentLikesModal')
    expect(modal).toContain('aria-modal="true"')
    expect(modal).toContain('aria-labelledby="content-likes-title"')
    expect(modal).toContain("limit: '20'")
    expect(modal).toContain('cursor: nextCursor')
    expect(modal).toContain('TwitterCloneFollowRow')
    expect(modal).toContain('requestControllerRef.current?.abort()')
  })
})
