import {
  PollVoteStoreError,
  type InsertPollVoteInput,
  type PollVoteRow,
  type PollVoteStore,
} from './poll-vote-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the W05 Worker does not bundle a database driver. */
export interface PollVotePostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const getVoteSql = `SELECT option_id,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
  FROM social_poll_votes
 WHERE poll_id = $1
   AND user_id = $2
 LIMIT 1`

const insertVoteSql = `INSERT INTO social_poll_votes (
    vote_id, poll_id, option_id, user_id, created_at
  )
  SELECT $1, poll.poll_id, poll_option.option_id, $2, $3::timestamptz
    FROM social_polls poll
    JOIN social_poll_options poll_option
      ON poll_option.poll_id = poll.poll_id
     AND poll_option.option_id = $4
   WHERE poll.content_id = $5
     AND poll.owner_user_id = $6
     AND poll.ends_at IS NOT NULL
     AND poll.ends_at > $7::timestamptz
     AND poll.poll_id = $8
     AND NOT EXISTS (
       SELECT 1
         FROM social_user_interactions block_relation
        WHERE block_relation.relation_type = 'block'
          AND ((block_relation.actor_user_id = $2 AND block_relation.target_user_id = $6)
            OR (block_relation.actor_user_id = $6 AND block_relation.target_user_id = $2))
     )
     AND NOT EXISTS (
       SELECT 1
         FROM social_poll_votes existing
        WHERE existing.poll_id = poll.poll_id
          AND existing.user_id = $2
     )
  ON CONFLICT (poll_id, user_id) DO NOTHING
  RETURNING option_id`

export function createPostgresPollVoteStore(db: PollVotePostgresQueryExecutor): PollVoteStore {
  return {
    async getVote(pollId: string, userId: string): Promise<PollVoteRow | null> {
      try {
        const result = await db.query<PollVoteRow>(getVoteSql, [pollId, userId])
        return result.rows[0] ?? null
      } catch {
        throw new PollVoteStoreError()
      }
    },

    async insertVote(input: InsertPollVoteInput): Promise<void> {
      try {
        await db.query(insertVoteSql, [
          input.voteId,
          input.userId,
          input.createdAt,
          input.optionId,
          input.contentId,
          input.ownerUserId,
          input.createdAt,
          input.pollId,
        ])
      } catch {
        throw new PollVoteStoreError()
      }
    },
  }
}
