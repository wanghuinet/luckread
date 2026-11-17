import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import entry from './entry.js'
import {
  closeW11AnalyticsPostgresDatabaseForTest,
  getW11AnalyticsPostgresDatabase,
  type W11AnalyticsHyperdriveBinding,
} from './analytics-postgres-runtime.js'

const connectionString = process.env.W11_PG_TEST_DATABASE_URL
const postgresSuite = connectionString ? describe : describe.skip

postgresSuite('W11 PostgreSQL 18 runtime integration', () => {
  let pool: Pool
  let binding: W11AnalyticsHyperdriveBinding | undefined

  beforeAll(async () => {
    if (!connectionString) throw new Error('W11_PG_TEST_DATABASE_URL is required')

    pool = new Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 5_000,
    })

    const migration = await readFile(
      new URL(
        './neon-postgres-migrations-d1-05/0001_w11_d1_05_analytics_schema.sql',
        import.meta.url,
      ),
      'utf8',
    )
    await pool.query(migration)

    const hyperdriveBinding = { connectionString }
    binding = hyperdriveBinding
    // Resolve through the exact Hyperdrive runtime path used by the Neon entry.
    getW11AnalyticsPostgresDatabase(hyperdriveBinding)
  })

  afterAll(async () => {
    if (binding) await closeW11AnalyticsPostgresDatabaseForTest(binding)
    await pool?.end()
  })

  it('enforces W01 transport security through the Neon entrypoint before any PostgreSQL write', async () => {
    const hyperdriveBinding = binding
    if (!hyperdriveBinding) throw new Error('W11 Hyperdrive test binding was not initialized')
    const legacyD1 = {
      prepare() {
        throw new Error('Neon entry must not access legacy D1_05')
      },
      batch() {
        throw new Error('Neon entry must not write legacy D1_05')
      },
    }
    const env = {
      W11_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_ANALYTICS_PG: hyperdriveBinding,
      D1_05: legacyD1,
    } as never
    const deniedEvent = {
      eventId: 'evt_pg18_denied_' + crypto.randomUUID().replaceAll('-', ''),
      dedupeKey: 'dedupe_pg18_denied_' + crypto.randomUUID().replaceAll('-', ''),
      eventName: 'content_open',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      sessionId: 'session_pg18_denied_01',
      contentId: 'content_pg18_denied_01',
      contentType: 'article',
    }
    const trustedHeaders = {
      'Content-Type': 'application/json',
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'corr_pg18_security_000001',
    }
    const post = (headers: Record<string, string>, body = JSON.stringify({ events: [deniedEvent] })) =>
      entry.fetch(new Request('https://w11.internal/internal/analytics/events', {
        method: 'POST',
        headers,
        body,
      }), env)

    const missingCallerHeaders = Object.fromEntries(
      Object.entries(trustedHeaders).filter(([name]) => name !== 'X-LuckRead-Caller'),
    )
    expect((await post(missingCallerHeaders)).status).toBe(404)
    expect((await post({ ...trustedHeaders, 'X-LuckRead-Caller': 'W05' })).status).toBe(404)
    expect((await post({ ...trustedHeaders, 'X-LuckRead-Transport-Version': '2.0' })).status).toBe(404)
    expect((await post({ ...trustedHeaders, 'X-LuckRead-Correlation-Id': 'bad correlation' })).status).toBe(404)
    expect((await post({
      ...trustedHeaders,
      'X-LuckRead-Principal-User-Id': 'invalid principal!',
    })).status).toBe(403)
    expect((await post({ ...trustedHeaders, 'Content-Type': 'text/plain' })).status).toBe(415)
    expect((await post(trustedHeaders, 'x'.repeat(65 * 1024))).status).toBe(413)
    expect((await post(trustedHeaders, JSON.stringify({
      events: [{ ...deniedEvent, eventName: 'like_created' }],
    }))).status).toBe(422)
    expect((await post(trustedHeaders, JSON.stringify({
      events: [{ ...deniedEvent, actorId: 'untrusted-client-field' }],
    }))).status).toBe(422)

    const oversizedBatch = {
      events: Array.from({ length: 91 }, (_, index) => ({
        ...deniedEvent,
        eventId: deniedEvent.eventId + '_' + index,
        dedupeKey: deniedEvent.dedupeKey + '_' + index,
      })),
    }
    expect((await post(trustedHeaders, JSON.stringify(oversizedBatch))).status).toBe(422)

    const unsupportedRead = await entry.fetch(
      new Request('https://w11.internal/api/analytics/creators'),
      env,
    )
    expect(unsupportedRead.status).toBe(404)

    const persisted = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM analytics_event_dedupe WHERE event_id LIKE $1',
      ['evt_pg18_denied_%'],
    )
    expect(persisted.rows[0]?.count).toBe(0)
    expect(legacyD1.prepare).not.toHaveBeenCalled
    expect(legacyD1.batch).not.toHaveBeenCalled
  })

  it('executes the Neon deployment entrypoint, W01 ingestion, deduplication, projection and rollback on PostgreSQL', async () => {
    const hyperdriveBinding = binding
    if (!hyperdriveBinding) throw new Error('W11 Hyperdrive test binding was not initialized')
    const legacyD1 = {
      prepare() {
        throw new Error('Neon entry must not access legacy D1_05')
      },
      batch() {
        throw new Error('Neon entry must not write legacy D1_05')
      },
    }
    const env = {
      W11_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_ANALYTICS_PG: hyperdriveBinding,
      D1_05: legacyD1,
    } as never
    const event = {
      eventId: 'evt_pg18_runtime_0001',
      dedupeKey: 'dedupe_pg18_runtime_0001',
      eventName: 'content_open',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      sessionId: 'session_pg18_runtime_01',
      contentId: 'content_pg18_runtime_01',
      contentType: 'article',
    }
    const headers = {
      'Content-Type': 'application/json',
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'corr_pg18_runtime_000001',
    }
    const ingest = () => entry.fetch(
      new Request('https://w11.internal/internal/analytics/events', {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: [event] }),
      }),
      env,
    )

    const ready = await entry.fetch(
      new Request('https://w11.internal/readyz'),
      env,
    )
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({
      worker: 'W11',
      status: 'ready',
      database: 'reachable',
      schema: 'ready',
    })

    const first = await ingest()
    expect(first.status).toBe(200)
    const firstBody = await first.json() as {
      data: {
        received: number
        qualityCounts: { VALID: number }
        persistence: { inserted: number; duplicates: number }
      }
    }
    expect(firstBody.data.received).toBe(1)
    expect(firstBody.data.qualityCounts.VALID).toBe(1)
    expect(firstBody.data.persistence).toMatchObject({
      inserted: 1,
      duplicates: 0,
    })

    const ledger = await pool.query<{
      event_id: string
      actor_type: string
      projection_status: string
    }>(
      'SELECT event_id, actor_type, projection_status FROM analytics_event_dedupe WHERE event_id = $1',
      [event.eventId],
    )
    expect(ledger.rows).toEqual([{
      event_id: event.eventId,
      actor_type: 'visitor',
      projection_status: 'APPLIED',
    }])

    const aggregate = await pool.query<{
      opens: number
      impressions: number
    }>(
      'SELECT opens, impressions FROM analytics_content_hourly WHERE content_id = $1',
      [event.contentId],
    )
    expect(aggregate.rows).toEqual([{ opens: 1, impressions: 0 }])

    const duplicate = await ingest()
    expect(duplicate.status).toBe(200)
    const duplicateBody = await duplicate.json() as {
      data: {
        qualityCounts: { VALID: number; DUPLICATE: number }
        persistence: { inserted: number; duplicates: number }
      }
    }
    expect(duplicateBody.data.qualityCounts).toMatchObject({
      VALID: 0,
      DUPLICATE: 1,
    })
    expect(duplicateBody.data.persistence).toMatchObject({
      inserted: 0,
      duplicates: 1,
    })

    const aggregateAfterDuplicate = await pool.query<{ opens: number }>(
      'SELECT opens FROM analytics_content_hourly WHERE content_id = $1',
      [event.contentId],
    )
    expect(aggregateAfterDuplicate.rows).toEqual([{ opens: 1 }])

    const database = getW11AnalyticsPostgresDatabase(hyperdriveBinding)
    await expect(database.batch([
      database.prepare(
        'INSERT INTO analytics_rollup_watermark (consumer_name) VALUES (?)',
      ).bind('w11_pg18_rollback_probe'),
      database.prepare(
        'INSERT INTO analytics_rollup_watermark (consumer_name) VALUES (?)',
      ).bind('w11_pg18_rollback_probe'),
    ])).rejects.toThrow()

    const rollbackProbe = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM analytics_rollup_watermark WHERE consumer_name = $1',
      ['w11_pg18_rollback_probe'],
    )
    expect(rollbackProbe.rows[0]?.count).toBe('0')
  })
})
