/// <reference types="@cloudflare/workers-types" />

import { ReplyAudienceRuntimeError, type ReplyAudienceContentContext } from './reply-audience-runtime.js'

export type W03ContentBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type ReplyAudienceContextInput = {
  principalUserId: string
  principalLayer: string
  contentId: string
  correlationId: string
}

const validId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const serviceUnavailable = () => new ReplyAudienceRuntimeError('SERVICE_UNAVAILABLE', 503)

export async function fetchReplyAudienceContentContext(
  binding: W03ContentBinding | undefined,
  input: ReplyAudienceContextInput,
): Promise<ReplyAudienceContentContext> {
  if (!binding) throw serviceUnavailable()
  if (
    !validId.test(input.principalUserId) ||
    !validId.test(input.contentId) ||
    !/^L[2-8]$/.test(input.principalLayer) ||
    !input.correlationId.trim()
  ) {
    throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
  }

  let response: Response
  try {
    response = await binding.fetch(new Request(
      `https://luckread-w03.internal/internal/content/contents/${encodeURIComponent(input.contentId)}/reply-audience-context`,
      {
        method: 'GET',
        headers: {
          'X-LuckRead-Caller': 'W05',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': input.correlationId,
          'X-LuckRead-Principal-User-Id': input.principalUserId,
          'X-LuckRead-Principal-Layer': input.principalLayer,
        },
      },
    ))
  } catch {
    throw serviceUnavailable()
  }

  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    envelope = null
  }

  if (!response.ok) {
    if (response.status === 404) throw new ReplyAudienceRuntimeError('NOT_FOUND', 404)
    if (response.status === 403) throw new ReplyAudienceRuntimeError('PERMISSION_DENIED', 403)
    if (response.status === 429) throw new ReplyAudienceRuntimeError('RATE_LIMITED', 429)
    throw serviceUnavailable()
  }

  const data = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
    ? (envelope as { data?: unknown }).data
    : null
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw serviceUnavailable()

  const context = data as Partial<ReplyAudienceContentContext>
  if (
    context.contentId !== input.contentId ||
    context.ownerUserId !== input.principalUserId ||
    context.contentType !== 'post' ||
    !['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(String(context.state)) ||
    typeof context.updatedAt !== 'string' ||
    !context.updatedAt
  ) {
    throw serviceUnavailable()
  }

  return {
    contentId: context.contentId,
    ownerUserId: context.ownerUserId,
    contentType: 'post',
    state: context.state as ReplyAudienceContentContext['state'],
    updatedAt: context.updatedAt,
  }
}
