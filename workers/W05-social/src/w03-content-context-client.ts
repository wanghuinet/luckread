/// <reference types="@cloudflare/workers-types" />

import { ReplyAudienceRuntimeError } from './reply-audience-runtime.js'
import type { OwnedPostContext } from './owned-post-context.js'

export type W03ContentBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type OwnedPostContextInput = {
  principalUserId: string
  principalLayer: string
  contentId: string
  correlationId: string
}

const validId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const serviceUnavailable = () => new ReplyAudienceRuntimeError('SERVICE_UNAVAILABLE', 503)

/**
 * Fetch the authenticated owner's canonical post context from W03. The result
 * can be used by W05 social mutations without querying W03-owned contents.
 */
export async function fetchOwnedPostContext(
  binding: W03ContentBinding | undefined,
  input: OwnedPostContextInput,
): Promise<OwnedPostContext> {
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
      `https://luckread-w03.internal/internal/content/contents/${encodeURIComponent(input.contentId)}/owned-post-context`,
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

  const context = data as Partial<OwnedPostContext>
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
    state: context.state as OwnedPostContext['state'],
    updatedAt: context.updatedAt,
  }
}

type PublishedOwnerPostContextInput = {
  ownerUserId: string
  contentId: string
  correlationId: string
}

/**
 * Resolve a public profile's pinned post without impersonating the profile owner
 * as an authenticated principal. W03 only returns a published post when both
 * the content ID and requested public owner match its canonical row.
 */
export async function fetchPublishedOwnerPostContext(
  binding: W03ContentBinding | undefined,
  input: PublishedOwnerPostContextInput,
): Promise<OwnedPostContext> {
  if (!binding) throw serviceUnavailable()
  if (
    !validId.test(input.ownerUserId) ||
    !validId.test(input.contentId) ||
    !input.correlationId.trim()
  ) {
    throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
  }

  let response: Response
  try {
    response = await binding.fetch(new Request(
      `https://luckread-w03.internal/internal/content/contents/${encodeURIComponent(input.contentId)}/public-post-context/${encodeURIComponent(input.ownerUserId)}`,
      {
        method: 'GET',
        headers: {
          'X-LuckRead-Caller': 'W05',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': input.correlationId,
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

  const context = data as Partial<OwnedPostContext>
  if (
    context.contentId !== input.contentId ||
    context.ownerUserId !== input.ownerUserId ||
    context.contentType !== 'post' ||
    context.state !== 'PUBLISHED' ||
    typeof context.updatedAt !== 'string' ||
    !context.updatedAt
  ) {
    throw serviceUnavailable()
  }

  return {
    contentId: context.contentId,
    ownerUserId: context.ownerUserId,
    contentType: 'post',
    state: 'PUBLISHED',
    updatedAt: context.updatedAt,
  }
}

export type PublishedContentSocialContext = {
  contentId: string
  ownerUserId: string | null
  contentType: 'article' | 'post' | 'video'
  state: 'PUBLISHED'
  updatedAt: string
}

type PublishedContentSocialContextInput = {
  contentId: string
  correlationId: string
}

/**
 * Resolve the canonical owner of public content for notification routing.
 * This deliberately exposes only a minimal published-content envelope.
 */
export async function fetchPublishedContentSocialContext(
  binding: W03ContentBinding | undefined,
  input: PublishedContentSocialContextInput,
): Promise<PublishedContentSocialContext> {
  if (!binding) throw serviceUnavailable()
  if (!validId.test(input.contentId) || !input.correlationId.trim()) {
    throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
  }

  let response: Response
  try {
    response = await binding.fetch(new Request(
      `https://luckread-w03.internal/internal/content/contents/${encodeURIComponent(input.contentId)}/published-social-context`,
      {
        method: 'GET',
        headers: {
          'X-LuckRead-Caller': 'W05',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': input.correlationId,
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

  const context = data as Partial<PublishedContentSocialContext>
  if (
    context.contentId !== input.contentId ||
    !['article', 'post', 'video'].includes(String(context.contentType)) ||
    context.state !== 'PUBLISHED' ||
    typeof context.updatedAt !== 'string' ||
    !context.updatedAt.trim() ||
    !(context.ownerUserId === null || (typeof context.ownerUserId === 'string' && validId.test(context.ownerUserId)))
  ) {
    throw serviceUnavailable()
  }

  return {
    contentId: context.contentId,
    ownerUserId: context.ownerUserId,
    contentType: context.contentType as PublishedContentSocialContext['contentType'],
    state: 'PUBLISHED',
    updatedAt: context.updatedAt,
  }
}
