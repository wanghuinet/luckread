import type { PayloadRequest } from 'payload'
import { getCloudflareContext } from '@opennextjs/cloudflare'

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PAGE_LIMIT = 1000

type PaywallSnapshot = {
  previewBodyR2Key?: unknown
  premiumBodyR2Key?: unknown
}

function snapshotKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const snapshot = value as PaywallSnapshot
  return [snapshot.previewBodyR2Key, snapshot.premiumBodyR2Key]
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
}

export type PaywallGCResult = {
  contentId: string
  scanned: number
  deleted: number
  preserved: number
}

/**
 * Removes obsolete paywall R2 objects only after the content revision/restore
 * safety window has elapsed. Current objects and objects referenced by recent
 * revisions remain protected. The database stores provider-neutral R2 keys;
 * this service is the only Cloudflare-specific cleanup boundary.
 */
export async function garbageCollectPaywallObjects(
  req: PayloadRequest,
  contentId: string,
  now = new Date(),
): Promise<PaywallGCResult> {
  const cloudflare = await getCloudflareContext({ async: true })
  const bucket = cloudflare.env.R2 as R2Bucket | undefined
  if (!bucket) throw new Error('R2 binding is unavailable')

  const current = await req.payload.findByID({
    collection: 'content',
    id: contentId,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const protectedKeys = new Set<string>([
    ...snapshotKeys(current),
    String(current.previewBodyR2Key ?? ''),
    String(current.premiumBodyR2Key ?? ''),
  ].filter(Boolean))

  const cutoff = now.getTime() - RETENTION_MS
  let page = 1
  while (true) {
    const revisions = await req.payload.find({
      collection: 'content-revisions',
      where: {
        and: [
          { content: { equals: contentId } },
          { createdAt: { greater_than_equal: new Date(cutoff).toISOString() } },
        ],
      },
      limit: PAGE_LIMIT,
      page,
      depth: 0,
      overrideAccess: true,
      req,
    })

    for (const revision of revisions.docs) {
      const snapshot = (revision.snapshot ?? {}) as PaywallSnapshot
      for (const key of snapshotKeys(snapshot)) protectedKeys.add(key)
    }
    if (!revisions.hasNextPage) break
    page += 1
  }

  let scanned = 0
  let deleted = 0
  let preserved = 0
  let cursor: string | undefined

  do {
    const listed = await bucket.list({
      prefix: `content/${contentId}/paywall/`,
      limit: PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    })

    for (const object of listed.objects) {
      if (!/^content\/[^/]+\/paywall\/v\d+\/(preview|premium)\.json$/.test(object.key)) continue
      scanned += 1
      if (protectedKeys.has(object.key) || object.uploaded.getTime() >= cutoff) {
        preserved += 1
        continue
      }
      await bucket.delete(object.key)
      deleted += 1
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  return { contentId, scanned, deleted, preserved }
}
