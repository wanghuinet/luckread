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

/**
 * Resolve the persisted filename from a trusted media URL. Filename is one
 * candidate lookup key, not an authorization decision: Payload adapters may
 * persist a URL whose final path segment does not exactly equal filename.
 */
const filenameFromTrustedUrl = (value: string, origin: string): string | null => {
  const trusted = normalizedTrustedUrl(value, origin)
  if (!trusted) return null

  const segments = new URL(trusted).pathname.split('/').filter(Boolean)
  const encodedFilename = segments[segments.length - 1]
  if (!encodedFilename) return null

  let filename: string
  try {
    filename = decodeURIComponent(encodedFilename)
  } catch {
    return null
  }

  if (!filename.trim() || filename.includes('/') || filename.includes('\\')) return null
  return filename
}

/**
 * Include URL forms used by Payload upload adapters. These are lookup
 * candidates only; every returned record is still checked against the exact
 * canonical host and path before it can authorize a reference.
 */
const urlLookupCandidates = (value: string, canonical: string, origin: string): string[] => {
  const candidates = new Set([value, canonical])
  const trusted = normalizedTrustedUrl(value, origin)
  if (trusted) {
    const url = new URL(trusted)
    candidates.add(url.pathname + url.search)
  }
  return Array.from(candidates)
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
  const filenames = new Set<string>()
  const urlCandidates = new Set<string>()
  for (const ref of refs) {
    const canonical = normalizedTrustedUrl(ref, currentOrigin)
    const filename = filenameFromTrustedUrl(ref, currentOrigin)
    if (!canonical || !filename) return invalidReference()
    normalized.set(ref, canonical)
    filenames.add(filename)
    for (const candidate of urlLookupCandidates(ref, canonical, currentOrigin)) {
      urlCandidates.add(candidate)
    }
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

  // Keep the owner constraint outside the OR so neither lookup route can ever
  // return another account's media. Filename is the indexed fast path; URL
  // candidates cover legacy/adapter records whose stored filename differs
  // from the last URL segment. Authorization below still requires exact URL.
  const mediaResult = await payload.find({
    collection: 'media',
    where: {
      and: [
        { ownerUserId: { equals: String(payloadUserId) } },
        {
          or: [
            { filename: { in: Array.from(filenames) } },
            { url: { in: Array.from(urlCandidates) } },
          ],
        },
      ],
    },
    limit: 100,
    page: 1,
    depth: 0,
    overrideAccess: true,
    select: { id: true, filename: true, url: true, ownerUserId: true } as any,
  })

  const ownedCanonicalUrls = new Set<string>()
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
  }

  // Candidate lookup may use filename or URL variants, but only an exact
  // canonical URL belonging to this Payload user can authorize the reference.
  for (const ref of refs) {
    const canonical = normalized.get(ref)
    if (!canonical || !ownedCanonicalUrls.has(canonical)) return invalidReference()
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
  // Keep the pure reference validator safe to import in unit tests and
  // lightweight routes. Load Payload only when a social-post write actually
  // needs the authoritative media-record lookup.
  const [{ getPayload }, { default: config }] = await Promise.all([
    import('payload'),
    import('@payload-config'),
  ])
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
