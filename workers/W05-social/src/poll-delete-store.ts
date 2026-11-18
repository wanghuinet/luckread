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

