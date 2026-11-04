import { getPayload } from 'payload'

export type MediaOwnerPayload = Awaited<ReturnType<typeof getPayload>>

/** Resolve the authoritative Payload profile mapped to the authenticated W02 identity. */
export async function resolvePayloadOwnerUserId(
  payload: MediaOwnerPayload,
  identityId: string,
): Promise<string | null> {
  const profileResult = await payload.find({
    collection: 'users',
    where: { identityId: { equals: identityId } },
    limit: 1,
    page: 1,
    depth: 0,
    overrideAccess: true,
    select: { id: true } as any,
  })
  const profileId = profileResult.docs[0]?.id
  if (profileId === undefined || profileId === null) return null
  const normalizedId = String(profileId).trim()
  return normalizedId || null
}
