export type LikeCommentTargetReadRow = Readonly<{
  id: string
  state: string
  author_user_id: string | null
  content_id: string
}>

export interface LikeTargetContextReadStore {
  readCommentTarget(commentId: string): Promise<LikeCommentTargetReadRow | null>
  hasBidirectionalBlock(actorUserId: string, relatedUserIds: readonly string[]): Promise<boolean>
}
