/// <reference types="@cloudflare/workers-types" />

import type { PollReadRow } from './poll-read-store.js'

export type PollConfigurationOptionInput = {
  optionId: string
  text: string
  position: number
}

export type CreateDraftPollInput = {
  pollId: string
  contentId: string
  ownerUserId: string
  durationHours: 24 | 72 | 168
  durationMinutes: number
  createdAt: string
  options: PollConfigurationOptionInput[]
}

export type UpdateDraftPollInput = {
  pollId: string
  contentId: string
  ownerUserId: string
  durationHours: 24 | 72 | 168
  durationMinutes: number
  updatedAt: string
  options: PollConfigurationOptionInput[]
}

export interface PollConfigurationStore {
  getPoll(contentId: string): Promise<PollReadRow | null>
  listOptionTexts(pollId: string): Promise<string[]>
  countVotes(pollId: string): Promise<number>
  createDraftPoll(input: CreateDraftPollInput): Promise<void>
  updateDraftPoll(input: UpdateDraftPollInput): Promise<void>
}

export class PollConfigurationStoreError extends Error {
  constructor() { super('POLL_CONFIGURATION_STORE_UNAVAILABLE') }
}

export function createD1PollConfigurationStore(db: D1Database): PollConfigurationStore {
  return {
    async getPoll(contentId) {
      try {
        return await db.prepare(
          `SELECT poll_id, content_id, owner_user_id, duration_minutes, ends_at, created_at, updated_at
             FROM social_polls
            WHERE content_id = ?
            LIMIT 1`,
        ).bind(contentId).first<PollReadRow>()
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async listOptionTexts(pollId) {
      try {
        const result = await db.prepare(
          'SELECT option_text FROM social_poll_options WHERE poll_id = ? ORDER BY position ASC',
        ).bind(pollId).all<{ option_text: string }>()
        return (result.results ?? []).map(row => row.option_text)
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async countVotes(pollId) {
      try {
        const row = await db.prepare(
          'SELECT COUNT(*) AS count FROM social_poll_votes WHERE poll_id = ?',
        ).bind(pollId).first<{ count: number }>()
        return Number(row?.count ?? 0)
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async createDraftPoll(input) {
      try {
        await db.batch([
          db.prepare(
            'INSERT OR IGNORE INTO social_polls (poll_id, content_id, owner_user_id, duration_hours, duration_minutes, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
          ).bind(
            input.pollId,
            input.contentId,
            input.ownerUserId,
            input.durationHours,
            input.durationMinutes,
            input.createdAt,
            input.createdAt,
          ),
          ...input.options.map(option => db.prepare(
            `INSERT OR IGNORE INTO social_poll_options (option_id, poll_id, option_text, position)
             SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM social_polls WHERE poll_id = ?)`,
          ).bind(option.optionId, input.pollId, option.text, option.position, input.pollId)),
        ])
      } catch {
        throw new PollConfigurationStoreError()
      }
    },

    async updateDraftPoll(input) {
      try {
        await db.batch([
          db.prepare(
            'UPDATE social_polls SET duration_minutes = ?, duration_hours = ?, ends_at = NULL, updated_at = ? WHERE poll_id = ? AND content_id = ? AND owner_user_id = ? AND NOT EXISTS (SELECT 1 FROM social_poll_votes WHERE poll_id = ?)',
          ).bind(
            input.durationMinutes,
            input.durationHours,
            input.updatedAt,
            input.pollId,
            input.contentId,
            input.ownerUserId,
            input.pollId,
          ),
          db.prepare(
            `DELETE FROM social_poll_options
              WHERE poll_id = ?
                AND EXISTS (
                  SELECT 1 FROM social_polls
                   WHERE poll_id = ?
                     AND content_id = ?
                     AND owner_user_id = ?
                     AND updated_at = ?
                     AND NOT EXISTS (SELECT 1 FROM social_poll_votes WHERE poll_id = ?)
                )`,
          ).bind(
            input.pollId,
            input.pollId,
            input.contentId,
            input.ownerUserId,
            input.updatedAt,
            input.pollId,
          ),
          ...input.options.map(option => db.prepare(
            `INSERT INTO social_poll_options (option_id, poll_id, option_text, position)
             SELECT ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM social_polls
                 WHERE poll_id = ?
                   AND content_id = ?
                   AND owner_user_id = ?
                   AND updated_at = ?
                   AND NOT EXISTS (SELECT 1 FROM social_poll_votes WHERE poll_id = ?)
              )`,
          ).bind(
            option.optionId,
            input.pollId,
            option.text,
            option.position,
            input.pollId,
            input.contentId,
            input.ownerUserId,
            input.updatedAt,
            input.pollId,
          )),
        ])
      } catch {
        throw new PollConfigurationStoreError()
      }
    },
  }
}
