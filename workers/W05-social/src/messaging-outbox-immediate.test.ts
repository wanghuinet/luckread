import { describe, expect, it } from 'vitest'
import { isMessagingMutationRequest } from './entry.js'
describe('immediate outbox trigger request selection', () => {
 it('selects durable mutation endpoints', () => { for (const [p,m] of [['/internal/messaging/conversations/c/messages','POST'],['/internal/messaging/conversations/c/messages/m1','PATCH'],['/internal/messaging/conversations/c/read','POST'],['/internal/messaging/conversations/c/members','POST'],['/internal/messaging/conversations/c/members/u','DELETE'],['/internal/messaging/conversations/c/leave','POST'],['/internal/messaging/conversations/c/transfer-owner','POST'],['/internal/messaging/requests','POST']] as const) expect(isMessagingMutationRequest(new Request('https://test'+p,{method:m}))).toBe(true) })
 it('skips reads, typing and realtime', () => { for (const [p,m] of [['/internal/messaging/conversations','GET'],['/internal/messaging/conversations/c/messages','GET'],['/internal/messaging/conversations/c/typing','POST'],['/internal/messaging/conversations/c/realtime','GET']] as const) expect(isMessagingMutationRequest(new Request('https://test'+p,{method:m}))).toBe(false) })
})
