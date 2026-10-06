import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Media upload access', () => {
  it('requires authentication for creation and binds ownership server-side', () => {
    const media = read('src/collections/Media.ts')

    expect(media).toContain("create: authenticated")
    expect(media).toContain("name: 'ownerUserId'")
    expect(media).toContain("operation === 'create'")
    expect(media).toContain('data.ownerUserId = String(req.user.id)')
    expect(media).not.toContain("ownerUserId: req.body")
    expect(media).toContain("data.ownerUserId = (originalDoc as unknown as { ownerUserId?: string | number | null } | undefined)?.ownerUserId ?? null")
  })

  it('limits update and delete to the stored owner', () => {
    const media = read('src/collections/Media.ts')

    expect(media).toContain("update: ownsMedia")
    expect(media).toContain("delete: ownsMedia")
    expect(media).toContain("req.payload.findByID({ collection: 'media', id, depth: 0 })")
    expect(media).toContain("String((media as unknown as { ownerUserId?: string | number | null }).ownerUserId ?? '') === String(req.user.id)")
    const migration = read('src/migrations/20261002_120000_media_owner.ts')
    expect(migration).toContain('ALTER TABLE \\`media\\` ADD COLUMN \\`owner_user_id\\` text;')
  })

  it('enforces the 12-media limit across repeated uploads', () => {
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    expect(publisher).toContain('const remainingSlots = Math.max(0, 12 - assets.length)')
    expect(publisher).toContain('selected.slice(0, remainingSlots)')
    expect(publisher).toContain('最多添加 12 个媒体文件。')
    expect(publisher).toContain('已达到 12 个媒体文件上限，其余文件未上传。')
  })

  it('keeps the existing R2-backed Payload media collection and upload path', () => {
    const config = read('src/payload.config.ts')
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const assetLibrary = read('src/app/(payload)/v1beta/CreatorAssetLibrary.tsx')

    expect(config).toContain("r2Storage({")
    expect(config).toContain("collections: { media: true }")
    expect(publisher).toContain("authorizedFetch('/api/v1/media'")
    expect(publisher).toContain("headers: { 'Idempotency-Key': 'media-upload:' + crypto.randomUUID() }")
    expect(publisher).toContain("form.append('_payload', JSON.stringify({ alt: file.name }))")
    expect(publisher).not.toContain("form.append('alt', file.name)")
    expect(assetLibrary).toContain("form.append('_payload', JSON.stringify({ alt: file.name }))")
    expect(assetLibrary).not.toContain("form.append('alt', file.name)")
  })
})


  it('exposes the existing Payload/R2 upload handler through the stable v1 media path', () => {
    const route = read('src/app/api/v1/media/route.ts')

    expect(route).toContain("import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'")
    expect(route).toContain("new URL('/api/media', request.url)")
    expect(route).toContain('request.clone()')
    expect(route).toContain("slug: ['media']")
    expect(route).toContain('PayloadRouteContext')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })


  it('requires an idempotency key for stable media creation', () => {
    const route = read('src/app/api/v1/media/route.ts')

    expect(route).toContain("const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("if (!idempotencyKey || idempotencyKey.length > 256)")
    expect(route).toContain("status: 428")
    expect(route).toContain("code: 'PRECONDITION_REQUIRED'")
  })

  it('exposes media metadata through the stable v1 resource path', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(route).toContain("from '../../../../(payload)/api/[...slug]/route'")
    expect(route).toContain("slug: ['media', mediaId]")
    expect(route).toContain("new URL('/api/media/' + encodeURIComponent(mediaId), request.url)")
    expect(route).toContain('request.clone()')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })


  it('keeps media metadata owner-scoped and out of shared cache', () => {
    const media = read('src/collections/Media.ts')
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(media).toContain("read: ({ req }) => {")
    expect(media).toContain("return { ownerUserId: { equals: String(req.user.id) } }")
    expect(route).not.toContain("from '@/lib/public-response-cache'")
    expect(route).not.toContain('cachedPublicGet(')
    expect(route).toContain("cache-control': 'private, no-store'")
    expect(route).toContain('id: document.id ?? null')
    expect(route).toContain('alt: document.alt ?? null')
    expect(route).not.toContain('...document')
  })

  it('projects existing Payload/R2 media readiness without inventing a processing job', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(route).toContain("status: deliveryReady ? 'READY' : 'FAILED'")
    expect(route).toContain('typeof document.url === \'string\'')
    expect(route).toContain('does not claim transcoding has completed')
    expect(route).not.toContain('processing-job')
    expect(route).not.toContain('MediaProcessing')
  })


  it('exposes owner-authorized media deletion through the stable v1 resource path', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(route).toContain("DELETE as payloadMediaDelete")
    expect(route).toContain('type PayloadDeleteRouteContext = Parameters<typeof payloadMediaDelete>[1]')
    expect(route).toContain("new URL('/api/media/' + encodeURIComponent(mediaId), request.url)")
    expect(route).toContain("slug: ['media', mediaId]")
    expect(route).toContain('return payloadMediaDelete')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })

  it('requires an idempotency key for stable media deletion', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')
    const library = read('src/app/(payload)/v1beta/CreatorAssetLibrary.tsx')

    expect(route).toContain("const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("if (!idempotencyKey || idempotencyKey.length > 256)")
    expect(route).toContain("status: 428")
    expect(route).toContain("code: 'PRECONDITION_REQUIRED'")
    expect(library).toContain("'Idempotency-Key': 'media-delete:' + crypto.randomUUID()")
  })



  it('exposes owner-authorized media metadata updates through the stable v1 resource path', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(route).toContain("PATCH as payloadMediaPatch")
    expect(route).toContain('type PayloadPatchRouteContext = Parameters<typeof payloadMediaPatch>[1]')
    expect(route).toContain("new URL('/api/media/' + encodeURIComponent(mediaId), request.url)")
    expect(route).toContain("slug: ['media', mediaId]")
    expect(route).toContain('return payloadMediaPatch')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })


  it('lists only the authenticated creator media through the stable v1 collection path', () => {
    const route = read('src/app/api/v1/media/route.ts')

    expect(route).toContain("export async function GET(request: Request)")
    expect(route).toContain("await payload.auth({ headers: request.headers, canSetHeaders: false })")
    expect(route).not.toContain('readVerifiedPayloadTokenVersion')
    expect(route).not.toContain('validateSession(')
    expect(route).toContain("collection: 'media'")
    expect(route).toContain("ownerUserId: { equals: String(authenticated.user.id) }")
    expect(route).toContain("sort: '-createdAt'")
    expect(route).toContain('Math.min(Math.max(requestedLimit, 1), 50)')
    expect(route).toContain('overrideAccess: false')
    expect(route).toContain("status: 401")
    expect(route).toContain("status: 503")
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })


  it('exposes a stable playback resource using the existing media delivery URL', () => {
    const route = read('src/app/api/v1/media/[mediaId]/playback/route.ts')

    expect(route).toContain("import { GET as getMedia } from '../route'")
    expect(route).toContain("status: 'READY'")
    expect(route).toContain("MEDIA_NOT_DELIVERABLE")
    expect(route).toContain('document.url')
    expect(route).toContain('mimeType')
    expect(route).toContain('filesize')
    expect(route).not.toContain('R2Bucket')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('signedUrl')
    expect(route).not.toContain('presigned')
  })

it('guards creator media listing before Payload authentication', () => {
  const route = read('src/app/api/v1/media/route.ts')
  const guardIndex = route.indexOf('await enforcePublicReadRateLimit(request)')
  const authIndex = route.indexOf('const authenticated = await authenticate(request)')
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(authIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(authIndex)
  expect(route).toContain('TrafficLimitError')
  expect(route).toContain('rateLimitResponse(request)')
})

it('guards media detail reads before the Payload route', () => {
  const route = read('src/app/api/v1/media/[mediaId]/route.ts')
  const guardIndex = route.indexOf('await enforcePublicReadRateLimit(request)')
  const payloadIndex = route.indexOf('await payloadMediaGet(')
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(payloadIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(payloadIndex)
  expect(route).toContain('TrafficLimitError')
})


it('guards media creation before the Payload upload handler', () => {
  const route = read('src/app/api/v1/media/route.ts')
  const guardIndex = route.indexOf('await enforceW01WriteRateLimit(request)')
  const payloadIndex = route.indexOf('return payloadMediaPost(')
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(payloadIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(payloadIndex)
})

it('guards media update and delete before the Payload handlers', () => {
  const route = read('src/app/api/v1/media/[mediaId]/route.ts')
  expect(route).toContain('await enforceW01WriteRateLimit(request)')
  expect(route).toContain('return payloadMediaDelete')
  expect(route).toContain('return payloadMediaPatch')
  const guards = [...route.matchAll(/await enforceW01WriteRateLimit\(request\)/g)]
  expect(guards.length).toBe(2)
})
