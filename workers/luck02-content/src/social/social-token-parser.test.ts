import { describe, expect, it } from 'vitest'
import { extractSocialTokens } from './social-token-parser.js'

describe('social token parser', () => {
  it('extracts unicode mentions and hashtags', () => {
    expect(extractSocialTokens('你好 @Alice #旅行 日本 #旅行')).toEqual([
      { kind: 'mention', value: '@Alice', normalized: 'alice', start: 3, end: 9 },
      { kind: 'hashtag', value: '#旅行', normalized: '旅行', start: 10, end: 13 },
    ])
  })

  it('does not treat emails or embedded fragments as social tokens', () => {
    expect(extractSocialTokens('mail@example.com a#tag foo/bar#baz https://x.test/#web')).toEqual([])
  })

  it('normalizes full-width forms and deduplicates by kind', () => {
    expect(extractSocialTokens('＠Ａｌｉｃｅ #Tag #tag')).toEqual([
      { kind: 'mention', value: '@Alice', normalized: 'alice', start: 0, end: 6 },
      { kind: 'hashtag', value: '#Tag', normalized: 'tag', start: 7, end: 11 },
    ])
  })
})
