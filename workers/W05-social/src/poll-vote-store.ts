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
