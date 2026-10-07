import { describe, expect, it } from 'vitest'

import { contentSlugFor, isContentSlug } from './content-slug.js'

describe('content slug', () => {
  it('keeps the slug stable when the title changes', () => {
    const id = '6f4dc6e8-4f5f-4e7e-9a6d-d2c1f931fabc'
    const first = contentSlugFor('Cloudflare 性能优化：缓存与 D1', id)
    const later = contentSlugFor('完全不同的新标题', id)

    expect(first).toBe('cloudflare-性能优化-缓存与-d1-6f4dc6e84f5f4e7e9a6dd2c1f931fabc')
    expect(first).not.toBe(later)
    expect(isContentSlug(first)).toBe(true)
  })

  it('falls back to a stable id-based slug for punctuation-only titles', () => {
    const slug = contentSlugFor('!!!???', 'abc123')
    expect(slug).toBe('content-abc123')
    expect(isContentSlug(slug)).toBe(true)
  })

  it('bounds and normalizes long titles', () => {
    const slug = contentSlugFor('A'.repeat(500), '1234567890abcdef')
    expect(slug.length).toBe(128)
    expect(slug).toBe('a'.repeat(95) + '-1234567890abcdef1234567890abcdef')
  })

  it('rejects malformed references', () => {
    expect(isContentSlug('')).toBe(false)
    expect(isContentSlug('/content/test')).toBe(false)
    expect(isContentSlug('content test')).toBe(false)
    expect(isContentSlug('-content')).toBe(false)
  })
})
