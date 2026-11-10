/// <reference types="@cloudflare/workers-types" />

export type PollDeleteRow = {
  poll_id: string
  content_id: string
  owner_user_id: string
}

export type PollDeleteInput = {
  pollId: string
  actorUserId: string
  contentId: string
}

export interface PollDeleteStore {
  getPoll(contentId: string): Promise<PollDeleteRow | null>
  countVotes(pollId: string): Promise<number>
  deleteDraftPoll(input: PollDeleteInput): Promise<boolean>
}

export class PollDeleteStoreError extends Error {
  constructor() { super('POLL_DELETE_STORE_UNAVAILABLE') }
}

export function createD1PollDeleteStore(db: D1Database): PollDeleteStore {
  return {
    async getPoll(contentId) {
      try {
        return await db.prepare(
          `SELECT poll_id, content_id, owner_user_id
             FROM social_polls
            WHERE content_id = ?
            LIMIT 1`,
        ).bind(contentId).first<PollDeleteRow>()
      } catch {
        throw new PollDeleteStoreError()
      }
    },

    async countVotes(pollId) {
      try {
        const row = await db.prepare(
          'SELECT COUNT(*) AS count FROM social_poll_votes WHERE poll_id = ?',
        ).bind(pollId).first<{ count: number }>()
        return Number(row?.count ?? 0)
      } catch {
        throw new PollDeleteStoreError()
      }
    },

    async deleteDraftPoll(input) {
      try {
        const results = await db.batch([
          db.prepare(
            `DELETE FROM social_poll_options
              WHERE poll_id = ?
                AND EXISTS (
                  SELECT 1
                    FROM social_polls
                   WHERE poll_id = ?
                     AND owner_user_id = ?
                     AND content_id = ?
                     AND NOT EXISTS (
                       SELECT 1 FROM social_poll_votes WHERE poll_id = ?
                     )
                )`,
          ).bind(input.pollId, input.pollId, input.actorUserId, input.contentId, input.pollId),
          db.prepare(
            `DELETE FROM social_polls
              WHERE poll_id = ?
                AND owner_user_id = ?
                AND content_id = ?
                AND NOT EXISTS (
                  SELECT 1 FROM social_poll_votes WHERE poll_id = ?
                )`,
          ).bind(input.pollId, input.actorUserId, input.contentId, input.pollId),
        ])
        return Number(results[1]?.meta?.changes ?? 0) === 1
      } catch {
        throw new PollDeleteStoreError()
      }
    },
  }
}
