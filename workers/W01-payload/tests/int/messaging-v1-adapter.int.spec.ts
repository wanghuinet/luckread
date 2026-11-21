import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const route = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('v1 messaging adapters', () => {
  const conversations = route('src/app/api/v1/conversations/route.ts')
  const messages = route('src/app/api/v1/conversations/[conversationId]/messages/route.ts')
  const readCursor = route('src/app/api/v1/conversations/[conversationId]/read/route.ts')

  it('uses the authenticated Better Auth-backed social principal for every operation', () => {
    for (const source of [conversations, messages, readCursor]) {
      expect(source).toContain('resolveCookieSocialPrincipal')
      expect(source).toContain('callW05Social')
      expect(source).not.toContain('getPayload(')
      expect(source).not.toContain('HYPERDRIVE')
      expect(source).not.toContain('D1Database')
    }
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
    expect(messages).toContain('encodeURIComponent(conversationId)')
  })

  it('forwards the authenticated read-cursor mutation only to W05', () => {
    expect(readCursor).toContain('/internal/messaging/conversations/')
    expect(readCursor).toContain('/read')
    expect(readCursor).toContain("method: 'POST'")
    expect(readCursor).toContain('encodeURIComponent(conversationId)')
  })

  it('does not implement a second persistence path in W01', () => {
    for (const source of [conversations, messages, readCursor]) {
      expect(source).not.toMatch(/INSERT INTO|UPDATE social_|SELECT .* FROM social_/i)
    }
  })
})
