export type MessagingAttachment = Readonly<{
  mediaId: string
  filename: string
  mimeType: string
  filesize: number
  width: number | null
  height: number | null
}>
export type MessagingConversationRow = Readonly<{
  conversation_id: string
  conversation_type: 'direct' | 'group'
  group_name: string | null
  member_count: number
  participant_user_id: string | null
  updated_at: string
  last_sequence: string
  last_message_id: string | null
  last_message_body: string | null
  last_message_sender_user_id: string | null
  last_message_created_at: string | null
  last_read_sequence: string
  unread_count: number
}>
export type MessagingConversationMemberRow = Readonly<{
  user_id: string
  member_role: 'owner' | 'member'
  joined_at: string
}>
export type MessagingMessageRow = Readonly<{
  message_id: string
  conversation_id: string
  sender_user_id: string
  sequence: string
  body: string
  attachments?: MessagingAttachment[]
  created_at: string
  edited_at?: string | null
  recalled_at?: string | null
}>
export interface MessagingStore {
  createDirectConversation(actorUserId: string, recipientUserId: string): Promise<{ conversationId: string }>
  createGroupConversation(actorUserId: string, memberUserIds: string[], groupName: string): Promise<{ conversationId: string }>
  listConversationMembers(actorUserId: string, conversationId: string): Promise<MessagingConversationMemberRow[]>
  addGroupMembers(actorUserId: string, conversationId: string, memberUserIds: string[]): Promise<{ addedCount: number }>
  removeGroupMember(actorUserId: string, conversationId: string, memberUserId: string): Promise<void>
  transferGroupOwnership(actorUserId: string, conversationId: string, targetUserId: string): Promise<void>
  leaveGroupConversation(actorUserId: string, conversationId: string): Promise<void>
  listConversations(actorUserId: string, cursor: string | null, limit: number): Promise<{
    items: MessagingConversationRow[]; nextCursor: string | null; hasMore: boolean
  }>
  listMessages(actorUserId: string, conversationId: string, beforeSequence: string | null, limit: number): Promise<{
    items: MessagingMessageRow[]; nextCursor: string | null; hasMore: boolean
  }>
  listMessagesAfter(actorUserId: string, conversationId: string, afterSequence: string, limit: number): Promise<{
    items: MessagingMessageRow[]; nextCursor: string | null; hasMore: boolean
  }>
  sendMessage(actorUserId: string, conversationId: string, clientMessageId: string, body: string, attachments?: MessagingAttachment[]): Promise<MessagingMessageRow>
  canReadAttachment(actorUserId: string, conversationId: string, mediaId: string): Promise<boolean>
  editMessage(actorUserId: string, conversationId: string, messageId: string, body: string): Promise<MessagingMessageRow>
  recallMessage(actorUserId: string, conversationId: string, messageId: string): Promise<MessagingMessageRow>
  markRead(actorUserId: string, conversationId: string, sequence: string): Promise<void>
}
export class MessagingStoreError extends Error {
  readonly code: string
  readonly status: number
  constructor(code = 'SERVICE_UNAVAILABLE', status = 503) {
    super('MESSAGING_STORE_UNAVAILABLE')
    this.name = 'MessagingStoreError'
    this.code = code
    this.status = status
  }
}
