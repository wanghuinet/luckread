// @vitest-environment node

import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Expo from 'expo-server-sdk'

import {
  createExpoPushClient,
  getExpoPushReceipts,
  sendExpoPushMessages,
} from './expo-push-service.js'

type JsonRecord = Record<string, unknown>

function requestBody(init: RequestInit | undefined): JsonRecord | JsonRecord[] {
  const body = init?.body
  if (typeof body === 'string') return JSON.parse(body) as JsonRecord
  if (body instanceof Uint8Array) return JSON.parse(gunzipSync(body).toString('utf8')) as JsonRecord | JsonRecord[]
  throw new Error('Unexpected Expo SDK request body type')
}

function expoToken(index: number): string {
  return 'ExponentPushToken[' + String(index).padStart(24, '0') + ']'
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('W10 Expo push service adapter', () => {
  it('delegates 100-message chunking, compression and authenticated sends to Expo SDK', async () => {
    let ticketNumber = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const messages = requestBody(init) as Array<{ to: string | string[] }>
      const tickets = messages.flatMap((message) => {
        const recipients = Array.isArray(message.to) ? message.to : [message.to]
        return recipients.map(() => ({ status: 'ok', id: 'receipt-' + String(++ticketNumber) }))
      })
      return Response.json({ data: tickets }, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createExpoPushClient({ accessToken: 'expo-server-access-token' })
    const messages = Array.from({ length: 101 }, (_, index) => ({
      to: expoToken(index),
      title: 'LuckRead',
      body: 'New activity',
    }))
    const tickets = await sendExpoPushMessages(client, messages)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requestBody(fetchMock.mock.calls[0]?.[1])).toHaveLength(100)
    expect(requestBody(fetchMock.mock.calls[1]?.[1])).toHaveLength(1)
    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(sentHeaders.get('Authorization')).toBe('Bearer expo-server-access-token')
    expect(sentHeaders.get('Content-Encoding')).toBe('gzip')
    expect(tickets).toHaveLength(101)
    expect(tickets.every((ticket) => ticket.status === 'ok')).toBe(true)
  })

  it('delegates 300-receipt chunking and aggregation to Expo SDK', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = requestBody(init) as { ids: string[] }
      return Response.json({
        data: Object.fromEntries(body.ids.map((id) => [id, { status: 'ok' }])),
      }, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createExpoPushClient()
    const receiptIds = Array.from({ length: 301 }, (_, index) => 'receipt-' + String(index))
    const receipts = await getExpoPushReceipts(client, receiptIds)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((requestBody(fetchMock.mock.calls[0]?.[1]) as { ids: string[] }).ids).toHaveLength(300)
    expect((requestBody(fetchMock.mock.calls[1]?.[1]) as { ids: string[] }).ids).toHaveLength(1)
    expect(Object.keys(receipts)).toHaveLength(301)
    expect(receipts['receipt-0']).toEqual({ status: 'ok' })
  })

  it('rejects invalid push tokens before making a network request and never echoes the token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = createExpoPushClient()
    const secretLikeInvalidToken = 'private-token-value-should-not-appear'

    await expect(sendExpoPushMessages(client, [{
      to: secretLikeInvalidToken,
      body: 'Notification',
    }])).rejects.toThrow('EXPO_PUSH_TOKEN_INVALID')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(Expo.isExpoPushToken(secretLikeInvalidToken)).toBe(false)
  })

  it('returns empty results without calling Expo when no messages or receipts exist', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = createExpoPushClient()

    await expect(sendExpoPushMessages(client, [])).resolves.toEqual([])
    await expect(getExpoPushReceipts(client, [])).resolves.toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
