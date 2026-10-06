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


  it('routes media upload through Better Auth while preserving Payload REST streaming', () => {
    const route = read('src/app/api/v1/media/route.ts')

    expect(route).toContain("import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'")
    expect(route).toContain('resolveBetterAuthPrincipalThroughW02(request)')
    expect(route).toContain('createPayloadBetterAuthBridgeToken')
    expect(route).toContain('createPayloadBetterAuthBridgeRequest')
    expect(route).toContain("path: '/api/media'")
    expect(route).toContain('request,')
    expect(route).toContain("slug: ['media']")
    expect(route).not.toContain('request.formData()')
    expect(route).not.toContain('request.arrayBuffer()')
    expect(route).not.toContain('new File(')
    expect(route).not.toContain('new Blob(')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })


  it('registers the Better Auth Payload bridge without disabling native Payload admin auth', () => {
    const users = read('src/collections/Users.ts')

    expect(users).toContain("import { payloadBetterAuthBridgeStrategy } from '@/auth/payload-better-auth-bridge'")
    expect(users).toContain('strategies: [payloadBetterAuthBridgeStrategy]')
    expect(users).toContain('removeTokenFromResponses: true')
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

    expect(route).toContain('getPayload')
    expect(route).toContain("collection: 'media'")
    expect(route).toContain('payload.findByID')
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


  it('uses the canonical Better Auth principal for media mutations', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(route).toContain('resolveBetterAuthPrincipalThroughW02(request)')
    expect(route).toContain("if (!principal.active || principal.tokenVersion === undefined)")
    expect(route).toContain("collection: 'media'")
    expect(route).toContain('overrideAccess: false')
    expect(route).toContain('user: { id: principal.userId }')
    expect(route).toContain('await payload.delete')
    expect(route).toContain('await payload.update')
    expect(route).not.toContain('payloadMediaDelete')
    expect(route).not.toContain('payloadMediaPatch')
  })

  it('exposes owner-authorized media deletion through the stable v1 resource path', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(route).toContain('await payload.delete')
    expect(route).toContain('overrideAccess: false')
    expect(route).toContain('user: { id: principal.userId }')
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

    expect(route).toContain('await payload.update')
    expect(route).toContain('overrideAccess: false')
    expect(route).toContain('user: { id: principal.userId }')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })


  it('lists only the authenticated creator media through the stable v1 collection path', () => {
    const route = read('src/app/api/v1/media/route.ts')

    expect(route).toContain("export async function GET(request: Request)")
    expect(route).toContain('resolveBetterAuthPrincipalThroughW02(request)')
    expect(route).toContain('principal.tokenVersion === undefined')
    expect(route).toContain("collection: 'media'")
    expect(route).not.toContain("await payload.auth({")
    expect(route).not.toContain('readVerifiedPayloadTokenVersion(request)')
    expect(route).not.toContain('validateSession({')
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

it('guards creator media listing before W02 authentication and preserves fail-closed service errors', () => {
  const route = read('src/app/api/v1/media/route.ts')
  const guardIndex = route.indexOf('await enforcePublicReadRateLimit(request)')
  const authIndex = route.indexOf('authenticated = await authenticate(request)')
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(authIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(authIndex)
  expect(route).toContain('TrafficLimitError')
  expect(route).toContain('rateLimitResponse(request)')
  expect(route).toContain("code: 'SERVICE_UNAVAILABLE'")
})

it('guards media detail reads before Better Auth and Payload Local API', () => {
  const route = read('src/app/api/v1/media/[mediaId]/route.ts')
  const guardIndex = route.indexOf('await enforcePublicReadRateLimit(request)')
  const authIndex = route.indexOf('const principal = await resolveBetterAuthPrincipalThroughW02(request)')
  const payloadIndex = route.indexOf('const payload = await getPayload({ config })')
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(authIndex).toBeGreaterThanOrEqual(0)
  expect(payloadIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(authIndex)
  expect(authIndex).toBeLessThan(payloadIndex)
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

it('guards media update and delete before Better Auth and Payload Local API', () => {
  const route = read('src/app/api/v1/media/[mediaId]/route.ts')
  expect(route).toContain('await enforceW01WriteRateLimit(request)')
  expect(route).toContain('resolveBetterAuthPrincipalThroughW02(request)')
  expect(route).toContain('await payload.delete')
  expect(route).toContain('await payload.update')
  const guards = [...route.matchAll(/await enforceW01WriteRateLimit\(request\)/g)]
  expect(guards.length).toBe(2)
})
