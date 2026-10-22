import { getPayload } from 'payload'

import config from '@payload-config'
import { resolvePublicArticleBodyUrl } from '../lib/article-summary-preview.js'

type JsonRecord = Record<string, unknown>

type PayloadReadPort = {
  find: (input: Record<string, unknown>) => Promise<{ docs: unknown[] }>
}

export type PostMediaReferenceValidation =
  | { valid: true }
  | {
      valid: false
      status: 401 | 422
      code: 'UNAUTHENTICATED' | 'VALIDATION_FAILED'
      message: string
    }

const invalidReference = (): PostMediaReferenceValidation => ({
  valid: false,
  status: 422,
  code: 'VALIDATION_FAILED',
  message: 'Post media references must point to existing media owned by the current account',
})

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null

const normalizedTrustedUrl = (value: string, origin: string): string | null => {
  const trusted = resolvePublicArticleBodyUrl(value, origin)
  if (!trusted) return null
  return new URL(trusted).toString()
}

const pathKey = (value: string, origin: string): string | null => {
  const trusted = resolvePublicArticleBodyUrl(value, origin)
  if (!trusted) return null
  const url = new URL(trusted)
  return url.pathname + url.search
}

const mediaProfileUnavailable: PostMediaReferenceValidation = {
  valid: false,
  status: 401,
  code: 'UNAUTHENTICATED',
  message: 'Account media profile is not available',
}

/**
 * Validate every post body, attachment, and cover reference against the
 * existing Payload Media records owned by the current Better Auth identity.
 * This verifies the media relation only; W03 remains authoritative for the
 * content and the stored reference relationship.
 */
export async function validateOwnedPostMediaReferencesWithPayload(
  payload: PayloadReadPort,
  principalUserId: string,
  input: unknown,
  currentOrigin: string,
): Promise<PostMediaReferenceValidation> {
  const record = asRecord(input)
  if (!record || record.contentType !== 'post') return { valid: true }

  const bodyRef = typeof record.bodyRef === 'string' ? record.bodyRef.trim() : ''
  const mediaRefs = record.mediaRefs === undefined ? [] : record.mediaRefs
  const coverRef = record.coverRef === undefined || record.coverRef === null
    ? null
    : typeof record.coverRef === 'string'
      ? record.coverRef.trim()
      : undefined

  if (
    !bodyRef ||
    bodyRef.length > 2048 ||
    !Array.isArray(mediaRefs) ||
    mediaRefs.length > 20 ||
    mediaRefs.some((value) => typeof value !== 'string' || !value.trim() || value.length > 2048) ||
    coverRef === undefined ||
    (typeof coverRef === 'string' && (!coverRef || coverRef.length > 2048))
  ) {
    return invalidReference()
  }

  const refs = Array.from(new Set([
    bodyRef,
    ...(mediaRefs as string[]).map((value) => value.trim()),
    ...(coverRef ? [coverRef] : []),
  ]))
  const normalized = new Map<string, string>()
  for (const ref of refs) {
    const value = normalizedTrustedUrl(ref, currentOrigin)
    if (!value) return invalidReference()
    normalized.set(ref, value)
  }

  const profileResult = await payload.find({
    collection: 'users',
    where: { identityId: { equals: principalUserId } },
    limit: 1,
    page: 1,
    depth: 0,
    overrideAccess: true,
    select: { id: true } as any,
  })
  const profile = asRecord(profileResult.docs[0])
  const payloadUserId = profile?.id
  if (payloadUserId === undefined || payloadUserId === null || !String(payloadUserId).trim()) {
    return mediaProfileUnavailable
  }

  // Query both the raw and normalized URL forms because an upload adapter may
  // store a relative URL while Payload returns the canonical absolute URL.
  // The final comparison is still restricted to trusted LuckRead URLs and
  // exact canonical URL/path matches for records owned by this user.
  const candidates = new Set<string>()
  for (const [ref, canonical] of normalized) {
    candidates.add(ref)
    candidates.add(canonical)
    const key = pathKey(ref, currentOrigin)
    if (key) candidates.add(key)
  }

  const mediaResult = await payload.find({
    collection: 'media',
    where: {
      and: [
        { ownerUserId: { equals: String(payloadUserId) } },
        { url: { in: Array.from(candidates) } },
      ],
    },
    limit: Math.min(candidates.size, 100),
    page: 1,
    depth: 0,
    overrideAccess: true,
    select: { id: true, url: true, ownerUserId: true } as any,
  })

  const ownedCanonicalUrls = new Set<string>()
  const ownedRelativePaths = new Set<string>()
  for (const value of mediaResult.docs) {
    const media = asRecord(value)
    if (
      !media ||
      String(media.ownerUserId ?? '') !== String(payloadUserId) ||
      typeof media.url !== 'string' ||
      !media.url.trim()
    ) continue

    const canonical = normalizedTrustedUrl(media.url, currentOrigin)
    if (canonical) ownedCanonicalUrls.add(canonical)
    if (media.url.trim().startsWith('/')) {
      const key = pathKey(media.url, currentOrigin)
      if (key) ownedRelativePaths.add(key)
    }
  }

  for (const ref of refs) {
    const canonical = normalized.get(ref)
    const key = pathKey(ref, currentOrigin)
    if (!canonical || (!ownedCanonicalUrls.has(canonical) && !(key && ownedRelativePaths.has(key)))) {
      return invalidReference()
    }
  }

  return { valid: true }
}

export async function validateOwnedPostMediaReferences(
  principalUserId: string,
  input: unknown,
  currentOrigin: string,
): Promise<PostMediaReferenceValidation> {
  const record = asRecord(input)
  if (!record || record.contentType !== 'post') return { valid: true }
  const payload = await getPayload({ config })
  return validateOwnedPostMediaReferencesWithPayload(
    payload as unknown as PayloadReadPort,
    principalUserId,
    input,
    currentOrigin,
  )
}

export const mediaReferenceValidationResponse = (
  result: Exclude<PostMediaReferenceValidation, { valid: true }>,
): Response => Response.json({
  error: { code: result.code, message: result.message, details: {} },
  requestId: 'req_' + crypto.randomUUID(),
}, {
  status: result.status,
  headers: { 'cache-control': 'no-store' },
})
