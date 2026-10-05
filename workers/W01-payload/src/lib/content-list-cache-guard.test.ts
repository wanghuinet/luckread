import { describe, expect, it } from 'vitest'
import {
  ContentListQueryError,
  hasAuthenticatedSessionCredential,
  validateContentListQuery,
} from './content-list-cache-guard.js'

describe('content list cache guard', () => {
  it('rejects duplicate contracted query keys before cache key generation', () => {
    expect(() => validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?limit=20&limit=21'),
    )).toThrow(ContentListQueryError)
  })

  it('rejects invalid and oversized contracted query values', () => {
    expect(() => validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?limit=51'),
    )).toThrow(ContentListQueryError)

    expect(() => validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?type=unknown'),
    )).toThrow(ContentListQueryError)

    expect(() => validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?creatorId=bad%20id'),
    )).toThrow(ContentListQueryError)

    expect(() => validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?cursor=' + 'x'.repeat(2049)),
    )).toThrow(ContentListQueryError)

    expect(() => validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?cursor=../not-a-cursor'),
    )).toThrow(ContentListQueryError)

    expect(validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?cursor=YWJjXzEyMy0'),
    ).toString()).toBe('cursor=YWJjXzEyMy0')
  })

  it('normalizes valid query values at the W01 boundary', () => {
    expect(validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?type=%20article%20&limit=%2020%20'),
    ).toString()).toBe('cursor=&creatorId=&limit=20&type=article'.replace('cursor=&creatorId=&',''))
  })

  it('rejects oversized raw query strings', () => {
    expect(() => validateContentListQuery(
      new URL('https://luckread.com/api/v1/contents?unknown=' + 'x'.repeat(4100)),
    )).toThrow(ContentListQueryError)
  })

  it('detects Authorization, Payload, and Better Auth session credentials', () => {
    expect(hasAuthenticatedSessionCredential(
      new Request('https://luckread.com/api/v1/contents', { headers: { Authorization: 'Bearer token' } }),
    )).toBe(true)

    expect(hasAuthenticatedSessionCredential(
      new Request('https://luckread.com/api/v1/contents', { headers: { cookie: 'payload-token=token' } }),
    )).toBe(true)

    expect(hasAuthenticatedSessionCredential(
      new Request('https://luckread.com/api/v1/contents', { headers: { cookie: 'better-auth.session_token=token' } }),
    )).toBe(true)

    expect(hasAuthenticatedSessionCredential(
      new Request('https://luckread.com/api/v1/contents', { headers: { cookie: '__Secure-better-auth.session_token=token' } }),
    )).toBe(true)

    expect(hasAuthenticatedSessionCredential(
      new Request('https://luckread.com/api/v1/contents', { headers: { cookie: 'better-auth.session_token=' } }),
    )).toBe(false)

    expect(hasAuthenticatedSessionCredential(
      new Request('https://luckread.com/api/v1/contents', { headers: { cookie: 'foo=bar' } }),
    )).toBe(false)
  })
})
