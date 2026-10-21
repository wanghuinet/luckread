export type OwnedPostContext = {
  contentId: string
  ownerUserId: string
  contentType: 'post'
  state: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
  updatedAt: string
}

