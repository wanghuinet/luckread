/// <reference types="@cloudflare/workers-types" />

export type PollVoteRow = {
  option_id: string
  created_at: string
}

export type InsertPollVoteInput = {
  voteId: string
  pollId: string
  contentId: string
  ownerUserId: string
  optionId: string
  userId: string
  createdAt: string
}

export interface PollVoteStore {
  getVote(pollId: string, userId: string): Promise<PollVoteRow | null>
  insertVote(input: InsertPollVoteInput): Promise<void>
}

export class PollVoteStoreError extends Error {
  constructor() { super('POLL_VOTE_STORE_UNAVAILABLE') }
}

export function createD1PollVoteStore(db: D1Database): PollVoteStore {
  return {
    async getVote(pollId, userId) {
      try {
        return await db.prepare(
          'SELECT option_id, created_at FROM social_poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1',
        ).bind(pollId, userId).first<PollVoteRow>()
      } catch {
        throw new PollVoteStoreError()
      }
    },

    async insertVote(input) {
      try {
        await db.prepare(
          `INSERT OR IGNORE INTO social_poll_votes (vote_id, poll_id, option_id, user_id, created_at)
           SELECT ?, p.poll_id, o.option_id, ?, ?
             FROM social_polls p
             JOIN social_poll_options o ON o.poll_id = p.poll_id AND o.option_id = ?
            WHERE p.content_id = ?
              AND p.owner_user_id = ?
              AND p.ends_at IS NOT NULL
              AND p.ends_at > ?
              AND p.poll_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM social_user_interactions b
                 WHERE b.relation_type = 'block'
                   AND ((b.actor_user_id = ? AND b.target_user_id = ?)
                     OR (b.actor_user_id = ? AND b.target_user_id = ?))
              )
              AND NOT EXISTS (
                SELECT 1 FROM social_poll_votes existing
                 WHERE existing.poll_id = p.poll_id AND existing.user_id = ?
              )`,
        ).bind(
          input.voteId,
          input.userId,
          input.createdAt,
          input.optionId,
          input.contentId,
          input.ownerUserId,
          input.createdAt,
          input.pollId,
          input.userId,
          input.ownerUserId,
          input.ownerUserId,
          input.userId,
          input.userId,
        ).run()
      } catch {
        throw new PollVoteStoreError()
      }
    },
  }
}
