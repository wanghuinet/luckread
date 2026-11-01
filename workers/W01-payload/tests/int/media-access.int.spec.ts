import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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
    expect(media).toContain("data.ownerUserId = original?.ownerUserId ?? null")
    expect(media).toContain("data.uploadIdempotencyKey = original?.uploadIdempotencyKey ?? null")
    expect(media).toContain("data.uploadFingerprint = original?.uploadFingerprint ?? null")
  })

  it('limits update and delete to the stored owner', () => {
    const media = read('src/collections/Media.ts')

    expect(media).toContain("update: ownsMedia")
    expect(media).toContain("delete: ownsMedia")
    expect(media).toContain("req.payload.findByID({ collection: 'media', id, depth: 0 })")
    expect(media).toContain("String((media as unknown as { ownerUserId?: string | number | null }).ownerUserId ?? '') === String(req.user.id)")
    const migration = read('src/migrations/20261002_120000_media_owner.ts')
    expect(migration).toContain('ALTER TABLE')
    expect(migration).toContain('owner_user_id')
  })

  it('enforces the 12-media limit across repeated uploads', () => {
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    expect(publisher).toContain('const remainingSlots = Math.max(0, 12 - assets.length)')
    expect(publisher).toContain('selected.slice(0, remainingSlots)')
    expect(publisher).toContain('最多添加 12 个媒体文件。')
    expect(publisher).toContain('已达到 12 个媒体文件上限，其余文件未上传。')
  })

  it('preserves HTTP status, error code, and request ID for publish and media failures', () => {
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')

    expect(publisher).toContain('function getApiFailureDiagnostic(response: Response, data: unknown, fallback: string)')
    expect(publisher).toContain("'HTTP ' + response.status")
    expect(publisher).toContain("'请求 ID ' + requestId")
    expect(publisher).toContain("getApiFailureDiagnostic(response, data, 'MEDIA_UPLOAD_FAILED')")
    expect(publisher).toContain("getApiFailureDiagnostic(response, data, 'CONTENT_SAVE_FAILED')")
    expect(publisher).toContain("getApiFailureDiagnostic(response, data, 'SUBMIT_FAILED')")
    expect(publisher).toContain("setError(code || '媒体上传失败，请检查文件后重试。')")
    expect(publisher).not.toContain("setError('媒体上传失败，请检查文件后重试。')")
  })

  it('keeps the existing R2-backed Payload media collection and upload path', () => {
    const config = read('src/payload.config.ts')
    const publisher = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const assetLibrary = read('src/app/(payload)/v1beta/CreatorAssetLibrary.tsx')

    expect(config).toContain("r2Storage({")
    expect(config).toContain("collections: { media: { prefix: 'media', generateFileURL: createPublicMediaUrl } }")
    expect(config).not.toContain('disablePayloadAccessControl')
    expect(config).toContain('generateFileURL: createPublicMediaUrl')
    expect(publisher).toContain('authorizedFetch<{')
    expect(publisher).toContain("'/api/v1/media'")
    expect(publisher).toContain("headers: { 'Idempotency-Key': 'media-upload:' + crypto.randomUUID() }")
    expect(publisher).toContain("form.append('_payload', JSON.stringify({ alt: file.name }))")
    expect(publisher).not.toContain("form.append('alt', file.name)")
    expect(assetLibrary).toContain("form.append('_payload', JSON.stringify({ alt: file.name }))")
    expect(assetLibrary).not.toContain("form.append('alt', file.name)")
  })

  it('keeps direct R2 public-domain binding disabled while media reads are owner-scoped', () => {
    const config = read('src/payload.config.ts')
    const media = read('src/collections/Media.ts')
    const directBindingWorkflow = resolve(process.cwd(), '../../.github/workflows/w01-r2-cdn-domain-binding.yml')
    const workerDomainWorkflow = read('../../.github/workflows/w01-public-domain-binding.yml')

    expect(config).toContain("collections: { media: { prefix: 'media', generateFileURL: createPublicMediaUrl } }")
    expect(config).not.toContain('disablePayloadAccessControl')
    expect(media).toContain("return { ownerUserId: { equals: String(req.user.id) } }")
    expect(existsSync(directBindingWorkflow)).toBe(false)
    expect(workerDomainWorkflow).toContain('attach "img.luckread.com"')
    expect(workerDomainWorkflow).toContain('attach "video.luckread.com"')
    expect(workerDomainWorkflow).toContain('.hostname == "img.luckread.com" and .service == "luckread-w01-payload"')
    expect(workerDomainWorkflow).toContain('.hostname == "video.luckread.com" and .service == "luckread-w01-payload"')
    const delivery = read('src/app/api/media-delivery/[...key]/route.ts')
    expect(delivery).toContain('public-media-reference?url=')
    expect(delivery).toContain('resolveOptionalCookieContentPrincipal(request)')
    expect(delivery).toContain('data.isMemberContent === true')
    expect(delivery).toContain('data.allowed === true')
    expect(delivery).toContain("memberOnlyDelivery ? 'private, no-store' : 'public, max-age=0, must-revalidate'")
    expect(delivery).toContain('privateOwnerDelivery(request, key, headOnly)')
    expect(delivery).toContain('cdn-cache-control')
    expect(delivery).toContain('parseMediaByteRange')
    const nextConfig = read('next.config.ts')
    expect(nextConfig).toContain("value: 'img.luckread.com'")
    expect(nextConfig).toContain("value: 'video.luckread.com'")
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
    expect(route).toContain("if (!idempotencyKey) return apiErrorResponse(428, 'PRECONDITION_REQUIRED'")
    expect(route).toContain("idempotencyKey.length > 256) return apiErrorResponse(422, 'VALIDATION_FAILED'")
    expect(route).toContain('normalizeApiErrorResponse')
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
    expect(route).toContain('await payloadMediaDelete(')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })

  it('requires an idempotency key for stable media deletion', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')
    const library = read('src/app/(payload)/v1beta/CreatorAssetLibrary.tsx')

    expect(route).toContain("const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("if (!idempotencyKey) return apiErrorResponse(428, 'PRECONDITION_REQUIRED'")
    expect(route).toContain("idempotencyKey.length > 256) return apiErrorResponse(422, 'VALIDATION_FAILED'")
    expect(route).toContain('normalizeApiErrorResponse')
    expect(library).toContain("'Idempotency-Key': 'media-delete:' + crypto.randomUUID()")
  })

  it('exposes owner-authorized media metadata updates through the stable v1 resource path', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')

    expect(route).toContain("PATCH as payloadMediaPatch")
    expect(route).toContain('type PayloadPatchRouteContext = Parameters<typeof payloadMediaPatch>[1]')
    expect(route).toContain("new URL('/api/media/' + encodeURIComponent(mediaId), request.url)")
    expect(route).toContain("slug: ['media', mediaId]")
    expect(route).toContain('await payloadMediaPatch(')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('R2Bucket')
  })


  it('correlates media upload 503 telemetry without logging sensitive exception details', () => {
    const route = read('src/app/api/v1/media/route.ts')

    expect(route).toContain("event: 'w01.media.upload_failure'")
    expect(route).toContain('requestId:')
    expect(route).toContain('upstreamStatus:')
    expect(route).toContain("'payload_media_create'")
    expect(route).toContain("'idempotency_lookup_after_upload'")
    expect(route).not.toContain('console.error(error)')
    expect(route).not.toContain('details.error.message')
    expect(route).not.toContain('details.error.stack')
  })

  it('distinguishes unauthenticated requests from W02 authentication-service failures', () => {
    const route = read('src/app/api/v1/media/route.ts')
    expect(route).toContain("import { getBetterAuthPrincipal, W02AuthClientError }")
    expect(route).toContain('error instanceof W02AuthClientError && error.status === 401')
    expect(route).toContain("apiErrorResponse(401, 'UNAUTHENTICATED'")
    expect(route).toContain("apiErrorResponse(503, 'SERVICE_UNAVAILABLE'")
  })

  it('lists only the authenticated creator media through the stable v1 collection path', () => {
    const route = read('src/app/api/v1/media/route.ts')

    expect(route).toContain("export async function GET(request: Request)")
    expect(route).toContain('getBetterAuthPrincipal')
    expect(route).not.toContain('payload.auth(')
    expect(route).not.toContain('readVerifiedPayloadTokenVersion(request)')
    expect(route).not.toContain('validateSession(')
    expect(route).toContain("collection: 'media'")
    expect(route).toContain("where: { identityId: { equals: identityId } }")
    expect(route).toContain("resolvePayloadOwnerUserId(authenticated.payload, authenticated.identityId)")
    expect(route).toContain("ownerUserId: { equals: payloadUserId }")
    expect(route).not.toContain("ownerUserId: { equals: authenticated.userId }")
    expect(route).toContain("sort: '-createdAt'")
    expect(route).toContain('Math.min(Math.max(requestedLimit, 1), 50)')
    expect(route).toContain('overrideAccess: true')
    expect(route).toContain("apiErrorResponse(401, 'UNAUTHENTICATED'")
    expect(route).toContain("apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')")
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
    const authIndex = route.indexOf('authenticated = await authenticate(request)')
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
    const payloadIndex = route.indexOf('await payloadMediaPost(')
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(payloadIndex).toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(payloadIndex)
  })

  it('guards media update and delete before the Payload handlers', () => {
    const route = read('src/app/api/v1/media/[mediaId]/route.ts')
    expect(route).toContain('await enforceW01WriteRateLimit(request)')
    expect(route).toContain('await payloadMediaDelete(')
    expect(route).toContain('await payloadMediaPatch(')
    const guards = [...route.matchAll(/await enforceW01WriteRateLimit\(request\)/g)]
    expect(guards.length).toBe(2)
  })

  it('projects successful upload responses without exposing owner or idempotency internals', () => {
    const route = read('src/app/api/v1/media/route.ts')
    const projectionStart = route.indexOf('const publicMediaFields = (media: MediaUploadRecord) => ({')
    const projectionEnd = route.indexOf('/**', projectionStart)
    expect(projectionStart).toBeGreaterThanOrEqual(0)
    expect(projectionEnd).toBeGreaterThan(projectionStart)
    const projection = route.slice(projectionStart, projectionEnd)

    expect(route).toContain('projectSuccessfulMediaUploadResponse')
    expect(route).toContain('const projectedResponse = await projectSuccessfulMediaUploadResponse(response)')
    expect(route).not.toContain('return await appendRequestIdToJsonResponse(response)')
    for (const internalField of [
      'ownerUserId',
      'uploadIdempotencyKey',
      'uploadFingerprint',
      '_objectKey',
      'updatedAt',
      'createdAt',
      'thumbnailURL',
    ]) {
      expect(projection).not.toContain(internalField)
    }
    expect(projection).toContain('id: media.id ?? null')
    expect(projection).toContain('url: media.url ?? null')
    expect(projection).toContain('alt: media.alt ?? null')
  })

  it('persists upload idempotency metadata and replays completed uploads safely', () => {
    const media = read('src/collections/Media.ts')
    const route = read('src/app/api/v1/media/route.ts')
    const migration = read('src/migrations/20261022_120000_MIG_MEDIA_UPLOAD_IDEMPOTENCY_V1.ts')
    const inventory = read('../../contracts/payload/payload-native-inventory.v1.json')

    expect(media).toContain("name: 'uploadIdempotencyKey'")
    expect(media).toContain("name: 'uploadFingerprint'")
    expect(media).toContain("unique: true")
    expect(media).toContain("req.headers.get('Idempotency-Key')")
    expect(media).toContain("req.headers.get('X-LuckRead-Upload-Fingerprint')")
    expect(route).toContain('findUploadByIdempotencyKey')
    expect(route).toContain('resolvePreviousUpload')
    expect(route).toContain("apiErrorResponse(409, 'IDEMPOTENCY_KEY_REUSE_CONFLICT'")
    expect(route).toContain("where: { identityId: { equals: identityId } }")
    expect(route).toContain("resolvePayloadOwnerUserId(authenticated.payload, authenticated.identityId)")
    expect(migration).toContain('CREATE UNIQUE INDEX')
    expect(migration).toContain('media_upload_idempotency_key_idx')
    expect(inventory).toContain('uploadIdempotencyKey')
    expect(inventory).toContain('uploadFingerprint')
  })
