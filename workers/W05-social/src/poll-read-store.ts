
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

