import { describe, expect, it } from 'vitest'
import { validateUserProfilePatch } from './user-profile.js'

describe('W02 user profile input bounds', () => {
  it('accepts field values at the configured maximum length', () => {
    expect(
      validateUserProfilePatch({
        username: 'u'.repeat(128),
        displayName: 'd'.repeat(128),
        bio: 'b'.repeat(4000),
        avatar: 'a'.repeat(2048),
        locale: 'l'.repeat(32),
        timezone: 't'.repeat(128),
      }),
    ).toEqual({
      ok: true,
      data: {
        username: 'u'.repeat(128),
        displayName: 'd'.repeat(128),
        bio: 'b'.repeat(4000),
        avatar: 'a'.repeat(2048),
        locale: 'l'.repeat(32),
        timezone: 't'.repeat(128),
      },
    })
  })

  it('rejects any profile field that exceeds its configured limit', () => {
    const cases = [
      ['username', 'u'.repeat(129)],
      ['displayName', 'd'.repeat(129)],
      ['bio', 'b'.repeat(4001)],
      ['avatar', 'a'.repeat(2049)],
      ['locale', 'l'.repeat(33)],
      ['timezone', 't'.repeat(129)],
    ] as const

    for (const [field, value] of cases) {
      expect(validateUserProfilePatch({ [field]: value }), field).toEqual({ ok: false })
    }
  })

  it('continues to reject unknown fields and non-string values', () => {
    expect(validateUserProfilePatch({ role: 'admin' })).toEqual({ ok: false })
    expect(validateUserProfilePatch({ bio: 123 })).toEqual({ ok: false })
    expect(validateUserProfilePatch({ username: '   ' })).toEqual({ ok: false })
  })
})
