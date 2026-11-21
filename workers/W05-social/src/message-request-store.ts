export type MessageRequestRow = Readonly<{
  request_id: string
  sender_user_id: string
  recipient_user_id: string
  initial_message: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  conversation_id: string | null
  created_at: string
  responded_at: string | null
}>
export type MessageRequestPage = Readonly<{ items: MessageRequestRow[]; nextCursor: string | null; hasMore: boolean }>
export interface MessageRequestStore {
  createRequest(actorUserId: string, recipientUserId: string, clientRequestId: string, body: string): Promise<MessageRequestRow>
  listRequests(actorUserId: string, direction: 'incoming' | 'outgoing', cursor: string | null, limit: number): Promise<MessageRequestPage>
  respondRequest(actorUserId: string, requestId: string, action: 'accept' | 'decline' | 'cancel'): Promise<{ status: MessageRequestRow['status']; conversationId: string | null }>
}
export class MessageRequestStoreError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'MessageRequestStoreError' }
}
