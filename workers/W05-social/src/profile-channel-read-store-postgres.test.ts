import { describe, expect, it } from 'vitest'
import {
  ProfileChannelReadStoreError,
  type ProfileChannelReadStore,
} from './profile-channel-read-store.js'
import { createPostgresProfileChannelReadStore } from './profile-channel-read-store-postgres.js'

type Call = { sql: string; values: unknown[] }

function fakePostgres(options: {
  rows?: Record<string, unknown>[]
  fail?: boolean
} = {}) {
  const calls: Call[] = []
  const db = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('secret-postgres-host-and-driver-detail')
      return { rows: (options.rows ?? []) as Row[] }
    },
  }
  return { db, calls }
}

describe('W05 PostgreSQL ProfileChannelReadStore', () => {
  it('checks bilateral Block and viewer-directed Mute visibility', async () => {
    const { db, calls } = fakePostgres({ rows: [{ blocked: true, muted: false }] })
    const store = createPostgresProfileChannelReadStore(db)
    await expect(store.profileVisibility({ profileUserId: 'profile-1', viewerUserId: 'viewer-1' }))
      .resolves.toEqual({ blocked: true, muted: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['viewer-1', 'profile-1'])
    expect(calls[0]?.sql).toContain('block.actor_user_id = $1')
    expect(calls[0]?.sql).toContain('block.target_user_id = $2')
    expect(calls[0]?.sql).toContain('block.actor_user_id = $2')
    expect(calls[0]?.sql).toContain('block.target_user_id = $1')
    expect(calls[0]?.sql).toContain('mute.actor_user_id = $1 AND mute.target_user_id = $2')
  })

  it('reads published profile replies with microsecond timestamps and keyset pagination', async () => {
    const rows = [{
      id: 'reply-1',
      content_id: 'content-1',
      author_user_id: 'profile-1',
      parent_id: null,
      body: 'hello',
      state: 'PUBLISHED',
      depth: 0,
      created_at: '2026-11-10T04:00:00.123456Z',
      updated_at: '2026-11-10T04:00:00.123789Z',
    }]
    const { db, calls } = fakePostgres({ rows })
    const store = createPostgresProfileChannelReadStore(db)
    await expect(store.listReplies({
      profileUserId: 'profile-1',
      cursor: { createdAt: '2026-11-10T04:00:00.456789Z', tieBreaker: 'reply-2' },
      limit: 11,
    })).resolves.toEqual(rows)
    expect(calls[0]?.values).toEqual(['profile-1', '2026-11-10T04:00:00.456789Z', 'reply-2', 11])
    expect(calls[0]?.sql).toContain("c.state = 'PUBLISHED'")
    expect(calls[0]?.sql).toContain('c.created_at < $2::timestamptz')
    expect(calls[0]?.sql).toContain('c.created_at = $2::timestamptz')
    expect(calls[0]?.sql).toContain('c.id < $3')
    expect(calls[0]?.sql).toContain('ORDER BY c.created_at DESC, c.id DESC')
    expect(calls[0]?.sql).toContain('SS.US')
    expect(calls[0]?.sql).toContain('LIMIT $4')
    expect(calls[0]?.sql.toLowerCase()).not.toContain('from contents')
  })

  it('filters reply owners by bidirectional Block using bounded array parameters', async () => {
    const { db, calls } = fakePostgres({ rows: [{ actor_user_id: 'owner-1', target_user_id: 'profile-1' }] })
    const store = createPostgresProfileChannelReadStore(db)
    await expect(store.listReplyOwnerBlockRelations({
      profileUserId: 'profile-1',
      ownerUserIds: ['owner-1', 'owner-2'],
    })).resolves.toEqual([{ actor_user_id: 'owner-1', target_user_id: 'profile-1' }])
    expect(calls[0]?.values).toEqual(['profile-1', ['owner-1', 'owner-2']])
    expect(calls[0]?.sql).toContain('target_user_id = ANY($2::text[])')
    expect(calls[0]?.sql).toContain('actor_user_id = ANY($2::text[])')
  })

  it('preserves viewer-directed Block/Mute filtering and microsecond cursor semantics for liked content', async () => {
    const rows = [{ relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-11-10T04:00:00.123456Z' }]
    const { db, calls } = fakePostgres({ rows })
    const store = createPostgresProfileChannelReadStore(db)
    await expect(store.listLikedContents({
      profileUserId: 'profile-1',
      viewerUserId: 'viewer-1',
      cursor: { createdAt: '2026-11-10T04:00:00.456789Z', tieBreaker: 'like-2' },
      limit: 6,
    })).resolves.toEqual(rows)
    expect(calls[0]?.values).toEqual([
      'profile-1',
      'viewer-1',
      'viewer-1',
      'viewer-1',
      '2026-11-10T04:00:00.456789Z',
      'like-2',
      6,
    ])
    expect(calls[0]?.sql).toContain('block_profile')
    expect(calls[0]?.sql).toContain('mute_profile')
    expect(calls[0]?.sql).toContain('il.created_at < $5::timestamptz')
    expect(calls[0]?.sql).toContain('il.created_at = $5::timestamptz')
    expect(calls[0]?.sql).toContain('il.relationship_id < $6')
    expect(calls[0]?.sql).toContain('ORDER BY il.created_at DESC, il.relationship_id DESC')
    expect(calls[0]?.sql).toContain('LIMIT $7')
    expect(calls[0]?.sql).toContain('to_char(il.created_at AT TIME ZONE')
    expect(calls[0]?.sql).not.toContain('FROM contents')
  })

  it('supports anonymous liked-content reads without viewer-only Block/Mute predicates', async () => {
    const { db, calls } = fakePostgres()
    const store = createPostgresProfileChannelReadStore(db)
    await store.listLikedContents({
      profileUserId: 'profile-1',
      viewerUserId: null,
      cursor: null,
      limit: 11,
    })
    expect(calls[0]?.values).toEqual(['profile-1', 11])
    expect(calls[0]?.sql).not.toContain('block_profile')
    expect(calls[0]?.sql).not.toContain('mute_profile')
  })

  it('uses array parameters for owner Block and viewer-directed Mute filtering', async () => {
    const { db, calls } = fakePostgres({ rows: [{ actor_user_id: 'owner-1', target_user_id: 'viewer-1' }] })
    const store = createPostgresProfileChannelReadStore(db)
    await store.listLikedContentBlockRelations({
      principalUserIds: ['profile-1', 'viewer-1'],
      ownerUserIds: ['owner-1', 'owner-2'],
    })
    await store.listMutedOwners({ viewerUserId: 'viewer-1', ownerUserIds: ['owner-1', 'owner-2'] })
    expect(calls[0]?.values).toEqual([['profile-1', 'viewer-1'], ['owner-1', 'owner-2']])
    expect(calls[0]?.sql).toContain('actor_user_id = ANY($1::text[])')
    expect(calls[1]?.values).toEqual(['viewer-1', ['owner-1', 'owner-2']])
    expect(calls[1]?.sql).toContain('target_user_id = ANY($2::text[])')
  })

  it('short-circuits empty owner lists without querying the database', async () => {
    const { db, calls } = fakePostgres()
    const store = createPostgresProfileChannelReadStore(db)
    await expect(store.listReplyOwnerBlockRelations({ profileUserId: 'profile-1', ownerUserIds: [] })).resolves.toEqual([])
    await expect(store.listLikedContentBlockRelations({ principalUserIds: ['profile-1'], ownerUserIds: [] })).resolves.toEqual([])
    await expect(store.listMutedOwners({ viewerUserId: 'viewer-1', ownerUserIds: [] })).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('maps provider errors to a sanitized 503', async () => {
    const { db } = fakePostgres({ fail: true })
    const store: ProfileChannelReadStore = createPostgresProfileChannelReadStore(db)
    await expect(store.listReplies({ profileUserId: 'profile-1', cursor: null, limit: 11 }))
      .rejects.toBeInstanceOf(ProfileChannelReadStoreError)
    await expect(store.listReplies({ profileUserId: 'profile-1', cursor: null, limit: 11 }))
      .rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'PROFILE_CHANNEL_READ_UNAVAILABLE',
      })
  })
})
