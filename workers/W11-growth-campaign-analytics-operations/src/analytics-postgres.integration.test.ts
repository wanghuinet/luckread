import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createPostgresAnalyticsDatabase,
  type AnalyticsPostgresPool,
} from './analytics-postgres-store.js'
import worker, { type W11Env } from './worker.js'

const connectionString = process.env.W11_PG_TEST_DATABASE_URL
const postgresSuite = connectionString ? describe : describe.skip

postgresSuite('W11 PostgreSQL 18 runtime integration', () => {
  let pool: Pool
  let database: ReturnType<typeof createPostgresAnalyticsDatabase>

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

    database = createPostgresAnalyticsDatabase(
      pool as unknown as AnalyticsPostgresPool,
    )
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('executes W01 ingestion, schema readiness, deduplication, projection and rollback on PostgreSQL', async () => {
    const env: W11Env = {
      D1_05: database,
    }
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
    const ingest = () => worker.fetch(
      new Request('https://w11.internal/internal/analytics/events', {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: [event] }),
      }),
      env,
    )

    const ready = await worker.fetch(
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
