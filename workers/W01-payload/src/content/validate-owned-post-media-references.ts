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
 * Payload's upload URL is generated from the stored filename by the upload
 * adapter when a document is read. It is not a reliable database query key
 * immediately after the initial upload. Resolve only the final filename here;
 * the full generated URL is checked against the owner-scoped records below.
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
  for (const ref of refs) {
    const canonical = normalizedTrustedUrl(ref, currentOrigin)
    const filename = filenameFromTrustedUrl(ref, currentOrigin)
    if (!canonical || !filename) return invalidReference()
    normalized.set(ref, canonical)
    filenames.add(filename)
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

  // ownerUserId and filename are persisted fields. Query by those first, then
  // use Payload's read-time URL projection for an exact host + path comparison.
  // This avoids false 422s for fresh uploads whose generated url is not stored.
  const mediaResult = await payload.find({
    collection: 'media',
    where: {
      and: [
        { ownerUserId: { equals: String(payloadUserId) } },
        { filename: { in: Array.from(filenames) } },
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
      typeof media.filename !== 'string' ||
      !filenames.has(media.filename) ||
      typeof media.url !== 'string' ||
      !media.url.trim()
    ) continue

    const canonical = normalizedTrustedUrl(media.url, currentOrigin)
    if (canonical) ownedCanonicalUrls.add(canonical)
  }

  // Filename matches are only a lookup aid: a same-named asset under another
  // prefix or host must not authorize this reference.
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
