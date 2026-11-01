import { describe, expect, it } from 'vitest'

import {
  buildUsernameRedirectPathname,
  normalizeUsernameRedirectHandle,
  parseUsernameRoutePath,
  usernameRedirectFromPath,
  usernameRedirectTargetPath,
} from '../../src/lib/username-redirect'

describe('username 301 URL rules', () => {
  it('uses a case-folded history key and keeps the display username in the destination', () => {
    expect(usernameRedirectFromPath('HuiHui')).toBe('/@huihui')
    expect(usernameRedirectTargetPath('HuiXin')).toBe('/@HuiXin')
  })

  it('preserves the content-type route and immutable content ID', () => {
    expect(parseUsernameRoutePath('/@huihui/post/2116861177622433792')).toEqual({
      username: 'huihui',
      suffix: '/post/2116861177622433792',
    })
    for (const type of ['post', 'article', 'video', 'short']) {
      expect(buildUsernameRedirectPathname(`/@huihui/${type}/2116861177622433792`, 'huixin')).toBe(
        `/@huixin/${type}/2116861177622433792`,
      )
    }
  })

  it('does not redirect to itself and rejects invalid or encoded-slash handles', () => {
    expect(buildUsernameRedirectPathname('/@huihui/video/42', 'HUIHUI')).toBeNull()
    expect(normalizeUsernameRedirectHandle('@huihui')).toBeNull()
    expect(normalizeUsernameRedirectHandle('short')).toBeNull()
    expect(normalizeUsernameRedirectHandle('hu_i_hui')).toBeNull()
    expect(normalizeUsernameRedirectHandle('hui-hui')).toBeNull()
    expect(normalizeUsernameRedirectHandle('hui hui')).toBeNull()
    expect(parseUsernameRoutePath('/@bad%2Fhandle/post/42')).toBeNull()
  })
})
