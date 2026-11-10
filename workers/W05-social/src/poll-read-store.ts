/// <reference types="@cloudflare/workers-types" />

export type PollReadRow = {
  poll_id: string
  content_id: string
  owner_user_id: string
  duration_minutes: number
  ends_at: string | null
  created_at: string
  updated_at: string
}

export type PollOptionCountRow = {
  option_id: string
  option_text: string
  position: number
  votes: number
}

export interface PollReadStore {
  isBlocked(viewerUserId: string, ownerUserId: string): Promise<boolean>
  getPoll(contentId: string): Promise<PollReadRow | null>
  setEndsAtIfUnset(pollId: string, endsAt: string): Promise<void>
  listOptionsWithVoteCounts(pollId: string): Promise<PollOptionCountRow[]>
  getViewerOptionId(pollId: string, viewerUserId: string): Promise<string | null>
}

export class PollReadStoreError extends Error {
  constructor() { super('POLL_READ_STORE_UNAVAILABLE') }
}

export function createD1PollReadStore(db: D1Database): PollReadStore {
  return {
    async isBlocked(viewerUserId, ownerUserId) {
      try {
        const row = await db.prepare(
          \`SELECT 1
             FROM social_user_interactions
            WHERE relation_type = 'block'
              AND ((actor_user_id = ? AND target_user_id = ?)
                OR (actor_user_id = ? AND target_user_id = ?))
            LIMIT 1\`,
        ).bind(viewerUserId, ownerUserId, ownerUserId, viewerUserId).first()
        return Boolean(row)
      } catch {
        throw new PollReadStoreError()
      }
    },

    async getPoll(contentId) {
      try {
        return await db.prepare(
          \`SELECT poll_id, content_id, owner_user_id, duration_minutes, ends_at, created_at, updated_at
             FROM social_polls
            WHERE content_id = ?
            LIMIT 1\`,
        ).bind(contentId).first<PollReadRow>()
      } catch {
        throw new PollReadStoreError()
      }
    },

    async setEndsAtIfUnset(pollId, endsAt) {
      try {
        await db.prepare(
          'UPDATE social_polls SET ends_at = ? WHERE poll_id = ? AND ends_at IS NULL',
        ).bind(endsAt, pollId).run()
      } catch {
        throw new PollReadStoreError()
      }
    },

    async listOptionsWithVoteCounts(pollId) {
      try {
        const result = await db.prepare(
          \`SELECT o.option_id, o.option_text, o.position, COUNT(v.vote_id) AS votes
             FROM social_poll_options o
             LEFT JOIN social_poll_votes v ON v.poll_id = o.poll_id AND v.option_id = o.option_id
            WHERE o.poll_id = ?
            GROUP BY o.option_id, o.option_text, o.position
            ORDER BY o.position ASC\`,
        ).bind(pollId).all<PollOptionCountRow>()
        return result.results ?? []
      } catch {
        throw new PollReadStoreError()
      }
    },

    async getViewerOptionId(pollId, viewerUserId) {
      try {
        const vote = await db.prepare(
          'SELECT option_id FROM social_poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1',
        ).bind(pollId, viewerUserId).first<{ option_id: string }>()
        return vote?.option_id ?? null
      } catch {
        throw new PollReadStoreError()
      }
    },
  }
}
