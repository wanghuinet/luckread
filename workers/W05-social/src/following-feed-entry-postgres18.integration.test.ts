import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./notification-push-workflow.js', () => ({
  NotificationPushWorkflow: class TestNotificationPushWorkflow {},
}))

import entry from './entry.js'
import {
  closeW05PostgresRuntimeForTest,
  getW05PushEndpointPostgresDatabase,
  type W05SocialRuntimeEnv,
} from './neon/runtime.js'

const adminConnectionString = process.env.W05_ENTRY_PG_ADMIN_URL
const socialConnectionString = process.env.W05_ENTRY_PG_SOCIAL_URL
const governanceConnectionString = process.env.W05_ENTRY_PG_GOVERNANCE_URL
const reportPath = resolve(
  process.env.W05_ENTRY_PG_REPORT ??
    'artifacts/neon/w05-following-feed-entry-postgres18-postflight.json',
)
const integrationSuite = adminConnectionString && socialConnectionString && governanceConnectionString
  ? describe
  : describe.skip

function requireDisposableLocalDatabase(value: string | undefined, expectedName: string): URL {
  if (!value) throw new Error('W05 PostgreSQL entrypoint integration URLs are required')
  const target = new URL(value)
  if (
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    target.port !== '5432' ||
    target.pathname !== '/' + expectedName
  ) {
    throw new Error('Refusing W05 entrypoint rehearsal outside disposable local PostgreSQL ' + expectedName)
  }
  return target
}

integrationSuite('W05 Neon entrypoint following-feed PostgreSQL 18 integration', () => {
  let adminPool: Pool | undefined
  let socialPool: Pool | undefined
  let env: (W05SocialRuntimeEnv & { DB: unknown; D1_03: unknown }) | undefined

  const marker = 'w05-entry-pg18-' + randomUUID().replaceAll('-', '')
  const checks = {
    entersW05NeonWorkerThroughHyperdrive: false,
    d1_02SocialDatabaseIsReachable: false,
    d1_03DelegatedEndpointDatabaseIsReachable: false,
    w04TransportPrincipalAccepted: false,
    outboundBlockExcluded: false,
    inboundBlockExcluded: false,
    viewerDirectedMuteExcluded: false,
    reverseMuteDoesNotHideAuthor: false,
    stableFollowOrderingPreserved: false,
    authorIdOnlyProjectionPreserved: false,
    candidateWindowCappedAt500: false,
    candidateWindowTruncationReported: false,
    legacyD1BindingsNeverAccessed: false,
    syntheticRowsCleaned: false,
    disposableDatabasesDropped: false,
  }
  let runtimePassed = false
  let cleanupFailure: unknown

  const insertFollow = async (
    followerId: string,
    targetUserId: string,
    relationshipId: string,
    createdAt: string,
  ) => {
    await socialPool!.query(
      'INSERT INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES ($1, $2, $3, $4::timestamptz)',
      [relationshipId, followerId, targetUserId, createdAt],
    )
  }

  const insertInteraction = async (
    actorId: string,
    targetUserId: string,
    relationType: 'block' | 'mute',
    relationshipId: string,
    createdAt: string,
  ) => {
    await socialPool!.query(
      'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)',
      [relationshipId, actorId, targetUserId, relationType, createdAt],
    )
  }

  function makeRequest(viewerId: string) {
    return new Request('https://w05.internal/internal/social/feed/following-authors', {
      method: 'GET',
      headers: {
        'X-LuckRead-Caller': 'W04',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': marker + '-correlation',
        'X-LuckRead-Principal-User-Id': viewerId,
      },
    })
  }

  beforeAll(async () => {
    requireDisposableLocalDatabase(adminConnectionString, 'postgres')
    requireDisposableLocalDatabase(socialConnectionString, 'luckreadpro')
    requireDisposableLocalDatabase(governanceConnectionString, 'luckread_governance')

    adminPool = new Pool({
      connectionString: adminConnectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
    })
    await adminPool.query('DROP DATABASE IF EXISTS luckreadpro WITH (FORCE)')
    await adminPool.query('DROP DATABASE IF EXISTS luckread_governance WITH (FORCE)')
    await adminPool.query('CREATE DATABASE luckreadpro')
    await adminPool.query('CREATE DATABASE luckread_governance')

    socialPool = new Pool({
      connectionString: socialConnectionString,
      max: 3,
      connectionTimeoutMillis: 5_000,
    })
    const migration = await readFile(
      new URL('./neon-postgres-migrations/0001_w05_d1_02_social_schema.sql', import.meta.url),
      'utf8',
    )
    await socialPool.query(migration)

    const legacyD1 = {
      prepare: vi.fn(() => {
        throw new Error('W05 Neon entrypoint must never call legacy D1 prepare')
      }),
      batch: vi.fn(() => {
        throw new Error('W05 Neon entrypoint must never call legacy D1 batch')
      }),
    }

    env = {
      W05_DATABASE_DRIVER: 'neon',
      W05_PUSH_ENDPOINT_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: { connectionString: socialConnectionString },
      HYPERDRIVE_D1_03: { connectionString: governanceConnectionString },
      DB: legacyD1,
      D1_03: legacyD1,
    }
  })

  afterAll(async () => {
    try {
      if (env) await closeW05PostgresRuntimeForTest(env)
    } catch (error) {
      cleanupFailure ??= error
    }

    try {
      if (socialPool) {
        const remaining = await socialPool.query(
          'SELECT ' +
            '(SELECT count(*)::int FROM social_follow_relationships WHERE follower_user_id LIKE $1 OR target_user_id LIKE $1 OR relationship_id LIKE $1) AS follow_rows, ' +
            '(SELECT count(*)::int FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1 OR relationship_id LIKE $1) AS interaction_rows',
          [marker + '%'],
        )
        const followRows = remaining.rows[0]?.follow_rows ?? -1
        const interactionRows = remaining.rows[0]?.interaction_rows ?? -1
        expect(followRows).toBe(0)
        expect(interactionRows).toBe(0)
        checks.syntheticRowsCleaned = true
        await socialPool.end()
      }
    } catch (error) {
      cleanupFailure ??= error
    }

    try {
      if (adminPool) {
        await adminPool.query('DROP DATABASE IF EXISTS luckreadpro WITH (FORCE)')
        await adminPool.query('DROP DATABASE IF EXISTS luckread_governance WITH (FORCE)')
        const remaining = await adminPool.query(
          "SELECT count(*)::int AS count FROM pg_database WHERE datname IN ('luckreadpro', 'luckread_governance')",
        )
        checks.disposableDatabasesDropped = Number(remaining.rows[0]?.count ?? -1) === 0
        expect(checks.disposableDatabasesDropped).toBe(true)
        await adminPool.end()
      }
    } catch (error) {
      cleanupFailure ??= error
    }

    const report = {
      status: runtimePassed && !cleanupFailure &&
        checks.syntheticRowsCleaned && checks.disposableDatabasesDropped
        ? 'W05_FOLLOWING_FEED_NEON_ENTRY_POSTGRES18_PASS'
        : 'W05_FOLLOWING_FEED_NEON_ENTRY_POSTGRES18_FAILED',
      postgresMajor: 18,
      socialDatabase: 'luckreadpro',
      delegatedEndpointDatabase: 'luckread_governance',
      ...checks,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      productionBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')

    if (cleanupFailure) throw cleanupFailure
  })

  it('runs W04 following-feed candidates through the W05 Neon entrypoint and PostgreSQL 18', async () => {
    if (!env || !socialPool) throw new Error('W05 PostgreSQL entrypoint fixture was not initialized')

    const socialDatabase = await socialPool.query<{ database_name: string; version_num: number }>(
      "SELECT current_database() AS database_name, current_setting('server_version_num')::int AS version_num",
    )
    expect(socialDatabase.rows[0]?.database_name).toBe('luckreadpro')
    expect(Math.floor(Number(socialDatabase.rows[0]?.version_num) / 10_000)).toBe(18)
    checks.d1_02SocialDatabaseIsReachable = true

    const endpointDatabase = getW05PushEndpointPostgresDatabase(env)
    if (!endpointDatabase) throw new Error('W05 D1-03 endpoint Neon binding was not selected')
    const endpointProbe = await endpointDatabase.query<{ database_name: string }>(
      'SELECT current_database() AS database_name',
    )
    expect(endpointProbe.rows[0]?.database_name).toBe('luckread_governance')
    checks.d1_03DelegatedEndpointDatabaseIsReachable = true

    const policyViewer = marker + '-policy-viewer'
    const visibleOld = marker + '-visible-old'
    const visibleNew = marker + '-visible-new'
    const outboundBlocked = marker + '-outbound-blocked'
    const inboundBlocked = marker + '-inbound-blocked'
    const viewerMuted = marker + '-viewer-muted'
    const reverseMuted = marker + '-reverse-muted'
    const otherActor = marker + '-other-actor'
    const otherActorOnly = marker + '-other-actor-only'

    await insertFollow(policyViewer, visibleOld, marker + '-follow-old', '2026-11-10T04:00:00.000100Z')
    await insertFollow(policyViewer, visibleNew, marker + '-follow-new', '2026-11-10T04:03:00.000100Z')
    await insertFollow(policyViewer, outboundBlocked, marker + '-follow-outbound', '2026-11-10T04:04:00.000100Z')
    await insertFollow(policyViewer, inboundBlocked, marker + '-follow-inbound', '2026-11-10T04:05:00.000100Z')
    await insertFollow(policyViewer, viewerMuted, marker + '-follow-viewer-muted', '2026-11-10T04:06:00.000100Z')
    await insertFollow(policyViewer, reverseMuted, marker + '-follow-reverse-muted', '2026-11-10T04:02:00.000100Z')
    await insertFollow(otherActor, otherActorOnly, marker + '-follow-other', '2026-11-10T04:07:00.000100Z')

    await insertInteraction(policyViewer, outboundBlocked, 'block', marker + '-block-outbound', '2026-11-10T04:08:00.000100Z')
    await insertInteraction(inboundBlocked, policyViewer, 'block', marker + '-block-inbound', '2026-11-10T04:09:00.000100Z')
    await insertInteraction(policyViewer, viewerMuted, 'mute', marker + '-mute-viewer', '2026-11-10T04:10:00.000100Z')
    await insertInteraction(reverseMuted, policyViewer, 'mute', marker + '-mute-reverse', '2026-11-10T04:11:00.000100Z')

    const firstResponse = await entry.fetch(makeRequest(policyViewer), env as never, {} as never)
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as {
      data: { items: Array<{ userId: string }>; candidateWindowTruncated: boolean }
    }
    expect(first.data.items.map((item) => item.userId)).toEqual([
      visibleNew,
      reverseMuted,
      visibleOld,
    ])
    expect(first.data.candidateWindowTruncated).toBe(false)
    checks.entersW05NeonWorkerThroughHyperdrive = true
    checks.w04TransportPrincipalAccepted = true
    checks.outboundBlockExcluded = true
    checks.inboundBlockExcluded = true
    checks.viewerDirectedMuteExcluded = true
    checks.reverseMuteDoesNotHideAuthor = true
    checks.stableFollowOrderingPreserved = true
    checks.authorIdOnlyProjectionPreserved =
      Object.keys(first.data.items[0] ?? {}).join(',') === 'userId'
    expect(checks.authorIdOnlyProjectionPreserved).toBe(true)

    const bulkViewer = marker + '-bulk-viewer'
    const values: unknown[] = []
    const tuples: string[] = []
    for (let index = 1; index <= 501; index += 1) {
      const offset = values.length
      tuples.push(
        '($' + (offset + 1) + ', $' + (offset + 2) + ', $' +
          (offset + 3) + ', $' + (offset + 4) + '::timestamptz)',
      )
      values.push(
        marker + '-bulk-follow-' + String(index).padStart(4, '0'),
        bulkViewer,
        marker + '-bulk-author-' + String(index).padStart(4, '0'),
        '2026-11-10T05:00:00.000000Z',
      )
    }
    await socialPool.query(
      'INSERT INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES ' +
        tuples.join(', '),
      values,
    )

    const bulkResponse = await entry.fetch(makeRequest(bulkViewer), env as never, {} as never)
    expect(bulkResponse.status).toBe(200)
    const bulk = await bulkResponse.json() as {
      data: { items: Array<{ userId: string }>; candidateWindowTruncated: boolean }
    }
    expect(bulk.data.items).toHaveLength(500)
    expect(bulk.data.candidateWindowTruncated).toBe(true)
    expect(bulk.data.items[0]?.userId).toBe(marker + '-bulk-author-0501')
    expect(bulk.data.items[499]?.userId).toBe(marker + '-bulk-author-0002')
    expect(new Set(bulk.data.items.map((item) => item.userId)).size).toBe(500)
    checks.candidateWindowCappedAt500 = true
    checks.candidateWindowTruncationReported = true

    expect((env.DB as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
    expect((env.DB as { batch: ReturnType<typeof vi.fn> }).batch).not.toHaveBeenCalled()
    expect((env.D1_03 as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
    expect((env.D1_03 as { batch: ReturnType<typeof vi.fn> }).batch).not.toHaveBeenCalled()
    checks.legacyD1BindingsNeverAccessed = true

    runtimePassed = true
  })
})
