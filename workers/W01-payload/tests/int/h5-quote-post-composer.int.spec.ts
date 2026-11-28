import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isPublicQuotePostTarget } from '../../src/app/(frontend)/publish/quote-post'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('H5 quote-post flow', () => {
  it('accepts only the exact published public post target', () => {
    const target = { id: 'post-1', contentType: 'post', state: 'PUBLISHED', accessMode: 'PUBLIC' }
    expect(isPublicQuotePostTarget(target, 'post-1')).toBe(true)
    expect(isPublicQuotePostTarget({ ...target, id: 'post-2' }, 'post-1')).toBe(false)
    expect(isPublicQuotePostTarget({ ...target, contentType: 'article' }, 'post-1')).toBe(false)
    expect(isPublicQuotePostTarget({ ...target, state: 'DRAFT' }, 'post-1')).toBe(false)
    expect(isPublicQuotePostTarget({ ...target, accessMode: 'MEMBERS_ONLY' }, 'post-1')).toBe(false)
    expect(isPublicQuotePostTarget(null, 'post-1')).toBe(false)
  })

  it('wires the social-card quote action into the existing composer modal', () => {
    const card = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    const modal = read('src/app/(twitter-clone)/TwitterClonePostComposerModal.tsx')
    const composer = read('src/app/(frontend)/publish/PublishComposer.tsx')
    expect(card).toContain("new CustomEvent('luckread:open-post-composer'")
    expect(card).toContain('detail: { quoteContentId: contentId }')
    expect(modal).toContain("'luckread:open-post-composer'")
    expect(modal).toContain('quoteContentId={quoteContentId ?? undefined}')
    expect(modal).toContain('quoteRelationshipPending')
    expect(modal).toContain("event.key === 'Escape'")
    expect(composer).toContain("'luckread:quote-relationship-pending'")
    expect(composer).toContain("relationType: 'quote-post'")
    expect(composer).toContain("'/api/v1/contents/' + encodeURIComponent(sourceContentId) + '/relationships'")
    expect(composer).toContain("'Idempotency-Key': idempotencyKey")
    expect(composer).toContain('retryQuoteRelationship')
  })

  it('renders quoted post context only from the public W01 relationship and content APIs', () => {
    const preview = read('src/app/(frontend)/components/reuse/QuotePostRelationshipPreview.tsx')
    const card = read('src/app/(frontend)/components/reuse/LuckReadSocialPostCard.tsx')
    expect(preview).toContain("'/api/v1/contents/' + encodeURIComponent(contentId) + '/relationships?direction=out&limit=20'")
    expect(preview).toContain("item.relationType === 'quote-post' && item.direction === 'out'")
    expect(preview).toContain("'/api/v1/contents/' + encodeURIComponent(targetId)")
    expect(preview).toContain("targetPayload.accessMode !== 'PUBLIC'")
    expect(card).toContain('<QuotePostRelationshipPreview')
    expect(card).toContain('timelineCardNearViewport')
  })
})
