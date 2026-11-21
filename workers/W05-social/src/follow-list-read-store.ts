export type FollowListDirection = 'followers' | 'following'

export type FollowListCursor = Readonly<{
  createdAt: string
  relationshipId: string
}>

export type FollowListReadInput = Readonly<{
  userId: string
  direction: FollowListDirection
  cursor: FollowListCursor | null
  limit: number
}>

export type FollowListReadRow = Readonly<{
  relationship_id: string
  user_id: string
  followed_at: string
  /** Exact database ordering value for stable cursor pagination. */
  cursor_created_at?: string
}>

export type FollowListCountInput = Readonly<{
  userId: string
  direction: FollowListDirection
}>

export interface FollowListReadStore {
  list(input: FollowListReadInput): Promise<readonly FollowListReadRow[]>
  count(input: FollowListCountInput): Promise<number>
}
