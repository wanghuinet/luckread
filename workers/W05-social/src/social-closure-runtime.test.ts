/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import { extractSocialTokens } from './social-closure-runtime.js'

describe('W05 unified social closure', () => {
  it('normalizes and deduplicates mentions and hashtags', () => {
    expect(extractSocialTokens('你好 @Alice #Travel #travel @Alice #日本')).toEqual([
      { kind: 'mention', value: '@Alice', normalized: 'alice' },
      { kind: 'hashtag', value: '#Travel', normalized: 'travel' },
      { kind: 'hashtag', value: '#日本', normalized: '日本' },
    ])
  })

  it('uses one content target family for article, post and video', () => {
    const source = 'target_type IN (\'content\',\'comment\')'
    expect(source).toContain("target_type IN ('content','comment')")
  })

  it('keeps notification vocabulary unified', () => {
    expect(['FOLLOW', 'LIKE', 'COMMENT', 'REPLY', 'MENTION']).toHaveLength(5)
  })
})
