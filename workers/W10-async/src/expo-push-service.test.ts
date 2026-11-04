// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import Expo from 'expo-server-sdk'

import {
  createExpoPushClient,
  getExpoPushReceipts,
  sendExpoPushMessages,
} from './expo-push-service.js'

function expoToken(index: number): string {
  return 'ExponentPushToken[' + String(index).padStart(24, '0') + ']'
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('W10 Expo push service adapter', () => {
  it('delegates 100-message chunking, compression and authenticated sends to Expo SDK', async () => {
    let requestIndex = 0
    const fetchMock = vi.fn(async () => {
      const expectedCount = requestIndex++ === 0 ? 100 : 1
      const tickets = Array.from({ length: expectedCount }, (_, index) => ({
        status: 'ok',
        id: 'receipt-' + String(index),
      }))
      return Response.json({ data: tickets }, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createExpoPushClient({ accessToken: 'expo-server-access-token' })
    const messages = Array.from({ length: 101 }, (_, index) => ({
      to: expoToken(index),
      title: 'LuckRead',
      body: 'New activity',
    }))
    const sdkChunks = client.chunkPushNotifications(messages)
    const tickets = await sendExpoPushMessages(client, messages)

    expect(sdkChunks.map((chunk) => chunk.length)).toEqual([100, 1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(sentHeaders.get('Authorization')).toBe('Bearer expo-server-access-token')
    expect(sentHeaders.get('Content-Encoding')).toBe('gzip')
    expect(tickets).toHaveLength(101)
    expect(tickets.every((ticket) => ticket.status === 'ok')).toBe(true)
  })

  it('delegates 300-receipt chunking and aggregation to Expo SDK', async () => {
    const receiptIds = Array.from({ length: 301 }, (_, index) => 'receipt-' + String(index))
    const client = createExpoPushClient()
    const sdkChunks = client.chunkPushNotificationReceiptIds(receiptIds)
    let requestIndex = 0
    const fetchMock = vi.fn(async () => {
      const chunk = sdkChunks[requestIndex++] ?? []
      return Response.json({
        data: Object.fromEntries(chunk.map((id) => [id, { status: 'ok' }])),
      }, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const receipts = await getExpoPushReceipts(client, receiptIds)

    expect(sdkChunks.map((chunk) => chunk.length)).toEqual([300, 1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
