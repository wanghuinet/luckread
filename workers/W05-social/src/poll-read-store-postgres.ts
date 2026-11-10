import {
  PollReadStoreError,
  type PollOptionCountRow,
  type PollReadRow,
  type PollReadStore,
} from './poll-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the Worker bundle does not include a database driver. */
export interface PollReadPostgresQueryExecutor {
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

const isBlockedSql = `SELECT EXISTS (
    SELECT 1
      FROM social_user_interactions
     WHERE relation_type = 'block'
       AND ((actor_user_id = $1 AND target_user_id = $2)
         OR (actor_user_id = $2 AND target_user_id = $1))
  ) AS blocked`

const getPollSql = `SELECT ${POLL_COLUMNS}
  FROM social_polls
 WHERE content_id = $1
 LIMIT 1`

const setEndsAtIfUnsetSql = `UPDATE social_polls
   SET ends_at = $1::timestamptz
 WHERE poll_id = $2
   AND ends_at IS NULL`

const listOptionsSql = `SELECT
    o.option_id,
    o.option_text,
    o.position,
    COUNT(v.vote_id) AS votes
  FROM social_poll_options o
  LEFT JOIN social_poll_votes v
    ON v.poll_id = o.poll_id
   AND v.option_id = o.option_id
 WHERE o.poll_id = $1
 GROUP BY o.option_id, o.option_text, o.position
 ORDER BY o.position ASC`

const getViewerOptionIdSql = `SELECT option_id
  FROM social_poll_votes
 WHERE poll_id = $1
   AND user_id = $2
 LIMIT 1`

export function createPostgresPollReadStore(db: PollReadPostgresQueryExecutor): PollReadStore {
  return {
    async isBlocked(viewerUserId: string, ownerUserId: string): Promise<boolean> {
      try {
        const result = await db.query<{ blocked: boolean }>(isBlockedSql, [viewerUserId, ownerUserId])
        return result.rows[0]?.blocked === true
      } catch {
        throw new PollReadStoreError()
      }
    },

    async getPoll(contentId: string): Promise<PollReadRow | null> {
      try {
        const result = await db.query<PollReadRow>(getPollSql, [contentId])
        return result.rows[0] ?? null
      } catch {
        throw new PollReadStoreError()
      }
    },

    async setEndsAtIfUnset(pollId: string, endsAt: string): Promise<void> {
      try {
        await db.query(setEndsAtIfUnsetSql, [endsAt, pollId])
      } catch {
        throw new PollReadStoreError()
      }
    },

    async listOptionsWithVoteCounts(pollId: string): Promise<PollOptionCountRow[]> {
      try {
        const result = await db.query<PollOptionCountRow>(listOptionsSql, [pollId])
        return result.rows
      } catch {
        throw new PollReadStoreError()
      }
    },

    async getViewerOptionId(pollId: string, viewerUserId: string): Promise<string | null> {
      try {
        const result = await db.query<{ option_id: string }>(getViewerOptionIdSql, [pollId, viewerUserId])
        return result.rows[0]?.option_id ?? null
      } catch {
        throw new PollReadStoreError()
      }
    },
  }
}
