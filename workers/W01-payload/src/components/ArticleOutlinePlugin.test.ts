import { describe, expect, it } from 'vitest'
import { articleBlockDomId } from './ArticleOutlinePlugin.js'

describe('article editor outline anchors', () => {
  it('creates deterministic DOM ids for block identities', () => {
    expect(articleBlockDomId('heading-1')).toBe('lr-article-block-heading-1')
    expect(articleBlockDomId('heading/你好')).toBe(
      'lr-article-block-heading%2F%E4%BD%A0%E5%A5%BD',
    )
  })
})
