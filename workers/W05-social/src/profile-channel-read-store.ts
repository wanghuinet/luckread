export type ProfileChannelCursor = Readonly<{
  createdAt: string
  tieBreaker: string
}>

export type ProfileReplyReadRow = Readonly<{
  id: string
  content_id: string
  author_user_id: string
  parent_id: string | null
  body: string
  state: 'PUBLISHED'
  depth: number
  created_at: string
  updated_at: string
}>

export type ProfileLikedContentReadRow = Readonly<{
  relationship_id: string
  target_id: string
  created_at: string
}>

export type ProfileBlockRelationRow = Readonly<{
  actor_user_id: string
  target_user_id: string
}>

export type ProfileChannelReadStore = Readonly<{
  profileVisibility(input: Readonly<{
    profileUserId: string
    viewerUserId: string
  }>): Promise<Readonly<{ blocked: boolean; muted: boolean }>>
  listReplies(input: Readonly<{
    profileUserId: string
    cursor: ProfileChannelCursor | null
    limit: number
  }>): Promise<readonly ProfileReplyReadRow[]>
  listReplyOwnerBlockRelations(input: Readonly<{
    profileUserId: string
    ownerUserIds: readonly string[]
  }>): Promise<readonly ProfileBlockRelationRow[]>
  listLikedContents(input: Readonly<{
    profileUserId: string
    viewerUserId: string | null
    cursor: ProfileChannelCursor | null
    limit: number
  }>): Promise<readonly ProfileLikedContentReadRow[]>
  listLikedContentBlockRelations(input: Readonly<{
    principalUserIds: readonly string[]
    ownerUserIds: readonly string[]
  }>): Promise<readonly ProfileBlockRelationRow[]>
  listMutedOwners(input: Readonly<{
    viewerUserId: string
    ownerUserIds: readonly string[]
  }>): Promise<readonly Readonly<{ target_user_id: string }>[]>
}>

export class ProfileChannelReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('PROFILE_CHANNEL_READ_UNAVAILABLE')
    this.name = 'ProfileChannelReadStoreError'
  }
}

