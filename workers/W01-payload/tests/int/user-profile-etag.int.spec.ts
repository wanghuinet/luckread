import { describe, expect, it } from 'vitest'

import {
  etagForUserProfile,
  normalizeEtag,
  pickUserProfileSnapshot,
} from '../../src/auth/user-profile-etag'

describe('user profile ETag', () => {
  it('is deterministic for the same mutable profile fields', async () => {
    const user = {
      id: 10,
      email: 'person@example.com',
      username: 'author',
      displayName: 'Author',
      bio: 'Bio',
      avatar: '/avatar.jpg',
      locale: 'en-US',
      timezone: 'America/New_York',
    }

    expect(await etagForUserProfile(user)).toBe(await etagForUserProfile({ ...user, id: 11 }))
  })

  it('changes when a mutable profile field changes', async () => {
    const base = {
      username: 'author',
      displayName: 'Author',
      bio: 'Bio',
      avatar: '/avatar.jpg',
      locale: 'en-US',
      timezone: 'UTC',
    }

    expect(await etagForUserProfile(base)).not.toBe(
      await etagForUserProfile({ ...base, bio: 'Updated bio' }),
    )
  })

  it('normalizes weak quoted ETags for comparison', () => {
    expect(normalizeEtag(' W/"abc" ')).toBe('abc')
    expect(normalizeEtag('"abc"')).toBe('abc')
    expect(normalizeEtag('abc')).toBe('abc')
  })

  it('picks only client-writable profile fields', () => {
    expect(pickUserProfileSnapshot({
      id: 1,
      email: 'person@example.com',
      username: 'author',
      displayName: 'Author',
      bio: null,
      avatar: null,
      locale: 'en-US',
      timezone: 'UTC',
      password: 'secret',
    })).toEqual({
      username: 'author',
      displayName: 'Author',
      bio: null,
      avatar: null,
      locale: 'en-US',
      timezone: 'UTC',
    })
  })
})
