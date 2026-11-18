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
