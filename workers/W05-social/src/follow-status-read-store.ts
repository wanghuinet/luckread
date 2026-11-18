export type FollowStatusReadInput = Readonly<{
  followerUserId: string
  targetUserId: string
}>

export type FollowStatusReadRow = Readonly<{
  relationship_id: string
  created_at: string
  /** PostgreSQL returns a native boolean. */
  blocked: boolean
}>

export interface FollowStatusReadStore {
  getStatus(input: FollowStatusReadInput): Promise<FollowStatusReadRow | null>
}
