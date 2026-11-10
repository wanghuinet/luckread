import {
  PollConfigurationStoreError,
  type CreateDraftPollInput,
  type PollConfigurationStore,
  type UpdateDraftPollInput,
} from './poll-configuration-store.js'
import type { PollReadRow } from './poll-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the W05 Worker does not bundle a database driver. */
export interface PollConfigurationPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const POLL_COLUMNS = `poll_id, content_id, owner_user_id, duration_minutes,
  CASE WHEN ends_at IS NULL THEN NULL
    ELSE to_char(ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  END AS ends_at,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`

const getPollSql = `SELECT ${POLL_COLUMNS}
  FROM social_polls
 WHERE content_id = $1
 LIMIT 1`

const listOptionTextsSql = `SELECT option_text
  FROM social_poll_options
 WHERE poll_id = $1
 ORDER BY position ASC`

const countVotesSql = `SELECT COUNT(*) AS count
  FROM social_poll_votes
 WHERE poll_id = $1`

const createDraftPollSql = `WITH inserted_poll AS (
    INSERT INTO social_polls (
      poll_id, content_id, owner_user_id, duration_hours, duration_minutes,
      ends_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NULL, $6::timestamptz, $6::timestamptz)
    ON CONFLICT (content_id) DO NOTHING
    RETURNING poll_id
  ),
  inserted_options AS (
    INSERT INTO social_poll_options (option_id, poll_id, option_text, position)
    SELECT option_rows.option_id, poll.poll_id, option_rows.option_text, option_rows.position
      FROM inserted_poll poll
      CROSS JOIN unnest($7::text[], $8::text[], $9::integer[])
        AS option_rows(option_id, option_text, position)
    RETURNING option_id
  )
  SELECT
    (SELECT COUNT(*) FROM inserted_poll) AS inserted_poll_count,
    (SELECT COUNT(*) FROM inserted_options) AS inserted_option_count`

const updateDraftPollSql = `WITH eligible_poll AS MATERIALIZED (
    SELECT poll_id
      FROM social_polls
     WHERE poll_id = $1
       AND content_id = $2
       AND owner_user_id = $3
       AND NOT EXISTS (
         SELECT 1 FROM social_poll_votes WHERE poll_id = $1
       )
     FOR UPDATE
  ),
  updated_poll AS (
    UPDATE social_polls poll
       SET duration_hours = $4,
           duration_minutes = $5,
           ends_at = NULL,
           updated_at = $6::timestamptz
      FROM eligible_poll eligible
     WHERE poll.poll_id = eligible.poll_id
    RETURNING poll.poll_id
  ),
  deleted_options AS (
    DELETE FROM social_poll_options option
     USING updated_poll poll
     WHERE option.poll_id = poll.poll_id
    RETURNING option.option_id
  ),
  inserted_options AS (
    INSERT INTO social_poll_options (option_id, poll_id, option_text, position)
    SELECT option_rows.option_id, poll.poll_id, option_rows.option_text, option_rows.position
      FROM updated_poll poll
      CROSS JOIN (SELECT COUNT(*) FROM deleted_options) cleared
      CROSS JOIN unnest($7::text[], $8::text[], $9::integer[])
        AS option_rows(option_id, option_text, position)
     WHERE NOT EXISTS (
       SELECT 1 FROM social_poll_votes vote WHERE vote.poll_id = poll.poll_id
     )
    RETURNING option_id
  )
  SELECT
    EXISTS (SELECT 1 FROM updated_poll) AS updated,
    (SELECT COUNT(*) FROM inserted_options) AS inserted_option_count`

export function createPostgresPollConfigurationStore(
  db: PollConfigurationPostgresQueryExecutor,
): PollConfigurationStore {
  return {
    async getPoll(contentId: string): Promise<PollReadRow | null> {
      try {
        const result = await db.query<PollReadRow>(getPollSql, [contentId])
        return result.rows[0] ?? null
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async listOptionTexts(pollId: string): Promise<string[]> {
      try {
        const result = await db.query<{ option_text: string }>(listOptionTextsSql, [pollId])
        return result.rows.map(row => row.option_text)
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async countVotes(pollId: string): Promise<number> {
      try {
        const result = await db.query<{ count: number | string }>(countVotesSql, [pollId])
        return Number(result.rows[0]?.count ?? 0)
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async createDraftPoll(input: CreateDraftPollInput): Promise<void> {
      try {
        await db.query(createDraftPollSql, [
          input.pollId,
          input.contentId,
          input.ownerUserId,
          input.durationHours,
          input.durationMinutes,
          input.createdAt,
          input.options.map(option => option.optionId),
          input.options.map(option => option.text),
          input.options.map(option => option.position),
        ])
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async updateDraftPoll(input: UpdateDraftPollInput): Promise<void> {
      try {
        await db.query(updateDraftPollSql, [
          input.pollId,
          input.contentId,
          input.ownerUserId,
          input.durationHours,
          input.durationMinutes,
          input.updatedAt,
          input.options.map(option => option.optionId),
          input.options.map(option => option.text),
          input.options.map(option => option.position),
        ])
      } catch {
        throw new PollConfigurationStoreError()
      }
    },
  }
}
