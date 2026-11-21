import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const route = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('v1 messaging adapters', () => {
  const conversations = route('src/app/api/v1/conversations/route.ts')
  const messages = route('src/app/api/v1/conversations/[conversationId]/messages/route.ts')
  const readCursor = route('src/app/api/v1/conversations/[conversationId]/read/route.ts')
  const requests = route('src/app/api/v1/message-requests/route.ts')
  const requestAction = route('src/app/api/v1/message-requests/[requestId]/[action]/route.ts')

  it('uses the authenticated Better Auth-backed social principal for every operation', () => {
    for (const source of [conversations, messages, readCursor, requests, requestAction]) {
      expect(source).toContain('resolveCookieSocialPrincipal')
      expect(source).toContain('callW05Social')
      expect(source).not.toContain('HYPERDRIVE')
      expect(source).not.toContain('D1Database')
    }
  })

  it('keeps Payload access limited to verifying uploaded attachment ownership in W01', () => {
    expect(messages).toContain('validateOwnedMessageAttachments')
    expect(messages).toContain("collection: 'media'")
    expect(messages).toContain('ownerUserId')
    for (const source of [conversations, readCursor, requests, requestAction]) expect(source).not.toContain('getPayload(')
  })

  it('maps recipient identity through the canonical social profile identity resolver', () => {
    expect(conversations).toContain('resolveSocialProfileIdentityId')
    expect(conversations).toContain('recipientUserId')
    expect(conversations).toContain("pathname: '/internal/messaging/conversations'")
  })

  it('forwards conversation message reads and writes only to W05', () => {
    expect(messages).toContain('/internal/messaging/conversations/')
    expect(messages).toContain('/messages')
    expect(messages).toContain("method: 'GET'")
    expect(messages).toContain("method: 'POST'")
    expect(messages).toContain("(url.search || '')")
    expect(messages).toContain('encodeURIComponent(conversationId)')
  })

  it('forwards the authenticated read-cursor mutation only to W05', () => {
    expect(readCursor).toContain('/internal/messaging/conversations/')
    expect(readCursor).toContain('/read')
    expect(readCursor).toContain("method: 'POST'")
    expect(readCursor).toContain('encodeURIComponent(conversationId)')
  })

  it('forwards incoming and outgoing message request operations to W05 with canonical recipient identity', () => {
    expect(requests).toContain('resolveCookieSocialPrincipal')
    expect(requests).toContain('resolveSocialProfileIdentityId')
    expect(requests).toContain("pathname: '/internal/messaging/requests'")
    expect(requests).toContain("method: 'GET'")
    expect(requests).toContain("method: 'POST'")
    expect(requestAction).toContain('resolveCookieSocialPrincipal')
    expect(requestAction).toContain('/internal/messaging/requests/')
    expect(requestAction).toContain('encodeURIComponent(requestId)')
    expect(requestAction).toContain("['accept', 'decline', 'cancel']")
  })

  it('streams message attachments only after W05 conversation authorization', () => {
    const privateAttachment = route('src/app/api/v1/conversations/[conversationId]/attachments/[mediaId]/route.ts')
    expect(privateAttachment).toContain('resolveCookieSocialPrincipal')
    expect(privateAttachment).toContain('callW05Social')
    expect(privateAttachment).toContain('/attachments/')
    expect(privateAttachment).toContain('/authorize')
    expect(privateAttachment).toContain('bucket.head(key)')
    expect(privateAttachment).toContain('bucket.get(key')
    expect(privateAttachment).toContain("headers.set('cache-control', 'private, no-store')")
    expect(privateAttachment).not.toContain('searchParams.get(\'url\')')
  })

  it('does not implement a second persistence path in W01', () => {
    for (const source of [conversations, messages, readCursor]) {
      expect(source).not.toMatch(/INSERT INTO|UPDATE social_|SELECT .* FROM social_/i)
    }
  })
})
