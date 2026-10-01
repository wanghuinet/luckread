import { describe, expect, it } from 'vitest'
import {
  buildFollowListQuery,
  decodeFollowListCursor,
  encodeFollowListCursor,
  toFollowListItem,
} from './follow-read-runtime.js'

describe('SOCIAL-002 bounded follower/following read query', () => {
  it('builds followers query against target_user_id with stable cursor ordering', () => {
    const cursor = encodeFollowListCursor({
      createdAt: '2026-10-01T10:00:00.000Z',
      relationshipId: 'rel-9',
    })

    const query = buildFollowListQuery({
      direction: 'followers',
      subjectUserId: 'user-b',
      cursor,
      limit: 50,
    })

    expect(query.responseLimit).toBe(50)
    expect(query.readLimit).toBe(51)
    expect(query.sql).toContain('WHERE target_user_id = ?')
    expect(query.sql).toContain('created_at < ? OR (created_at = ? AND relationship_id < ?)')
    expect(query.sql).toContain('ORDER BY created_at DESC, relationship_id DESC LIMIT ?')
    expect(query.binds).toEqual(['user-b', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z', 'rel-9', 51])
  })

  it('builds following query against follower_user_id without dynamic SQL identifiers', () => {
    const query = buildFollowListQuery({
      direction: 'following',
      subjectUserId: 'user-a',
      limit: 10,
    })

    expect(query.sql).toContain('WHERE follower_user_id = ?')
    expect(query.sql).toContain('ORDER BY created_at DESC, relationship_id DESC LIMIT ?')
    expect(query.binds).toEqual(['user-a', 11])
  })

  it('rejects invalid cursor and limit', () => {
    expect(() => decodeFollowListCursor('not-base64')).toThrow('INVALID_CURSOR')
    expect(() => buildFollowListQuery({
      direction: 'followers',
      subjectUserId: 'user-b',
      limit: 51,
    })).toThrow('INVALID_LIMIT')
  })

  it('maps relationship rows without exposing relationshipId', () => {
    expect(toFollowListItem({
      relationshipId: 'rel-1',
      followerUserId: 'user-a',
      targetUserId: 'user-b',
      createdAt: '2026-10-01T10:00:00.000Z',
    }, 'followers')).toEqual({
      userId: 'user-a',
      createdAt: '2026-10-01T10:00:00.000Z',
    })

    expect(toFollowListItem({
      relationshipId: 'rel-1',
      followerUserId: 'user-a',
      targetUserId: 'user-b',
      createdAt: '2026-10-01T10:00:00.000Z',
    }, 'following')).toEqual({
      userId: 'user-b',
      createdAt: '2026-10-01T10:00:00.000Z',
    })
  })
})
