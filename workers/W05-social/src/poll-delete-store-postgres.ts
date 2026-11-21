import {
  PollDeleteStoreError,
  type PollDeleteInput,
  type PollDeleteRow,
  type PollDeleteStore,
} from './poll-delete-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the W05 Worker does not bundle a database driver. */
export interface PollDeletePostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const getPollSql = `SELECT poll_id, content_id, owner_user_id
  FROM social_polls
 WHERE content_id = $1
 LIMIT 1`

const countVotesSql = `SELECT COUNT(*) AS count
  FROM social_poll_votes
 WHERE poll_id = $1`

const deleteDraftPollSql = `WITH eligible_poll AS MATERIALIZED (
    SELECT poll_id
      FROM social_polls
     WHERE poll_id = $1
       AND owner_user_id = $2
       AND content_id = $3
       AND NOT EXISTS (
         SELECT 1
           FROM social_poll_votes
          WHERE poll_id = $1
       )
     FOR UPDATE
  ),
  deleted_options AS (
    DELETE FROM social_poll_options o
     USING eligible_poll p
     WHERE o.poll_id = p.poll_id
     RETURNING o.option_id
  ),
  deleted_poll AS (
    DELETE FROM social_polls p
     USING eligible_poll e
     WHERE p.poll_id = e.poll_id
     RETURNING p.poll_id
  )
  SELECT EXISTS (SELECT 1 FROM deleted_poll) AS deleted`

export function createPostgresPollDeleteStore(db: PollDeletePostgresQueryExecutor): PollDeleteStore {
  return {
    async getPoll(contentId: string): Promise<PollDeleteRow | null> {
      try {
        const result = await db.query<PollDeleteRow>(getPollSql, [contentId])
        return result.rows[0] ?? null
      } catch {
        throw new PollDeleteStoreError()
      }
    },

    async countVotes(pollId: string): Promise<number> {
      try {
        const result = await db.query<{ count: number | string }>(countVotesSql, [pollId])
        return Number(result.rows[0]?.count ?? 0)
      } catch {
        throw new PollDeleteStoreError()
      }
    },

    async deleteDraftPoll(input: PollDeleteInput): Promise<boolean> {
      try {
        const result = await db.query<{ deleted: boolean }>(deleteDraftPollSql, [
          input.pollId,
          input.actorUserId,
          input.contentId,
        ])
        return result.rows[0]?.deleted === true
      } catch {
        throw new PollDeleteStoreError()
      }
    },
  }
}
