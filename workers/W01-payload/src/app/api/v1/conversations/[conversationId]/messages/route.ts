import { getPayload } from 'payload'
import config from '@payload-config'
import { getBetterAuthPrincipal } from '@/auth/w02-session-client'
import { resolvePayloadOwnerUserId } from '@/media/media-owner'
import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ conversationId: string }> }

type MessageAttachmentInput = {
  mediaId: string
  filename: string
  mimeType: string
  filesize: number
  width: number | null
  height: number | null
}

async function validateOwnedMessageAttachments(request: Request, value: unknown): Promise<MessageAttachmentInput[]> {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 4) throw new Error('VALIDATION_FAILED')
  const principal = await getBetterAuthPrincipal(request)
  const payload = await getPayload({ config })
  const ownerUserId = await resolvePayloadOwnerUserId(payload, principal.userId)
  if (!ownerUserId) throw new Error('UNAUTHENTICATED')
  const seen = new Set<string>()
  const attachments: MessageAttachmentInput[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('VALIDATION_FAILED')
    const mediaId = typeof (item as { mediaId?: unknown }).mediaId === 'string'
      ? (item as { mediaId: string }).mediaId.trim()
      : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(mediaId) || seen.has(mediaId)) throw new Error('VALIDATION_FAILED')
    seen.add(mediaId)
    const media = await payload.findByID({
      collection: 'media',
      id: mediaId,
      depth: 0,
      overrideAccess: true,
    }).catch(() => null) as unknown as {
      id?: string | number
      ownerUserId?: string | number | null
      filename?: string | null
      mimeType?: string | null
      filesize?: number | null
      width?: number | null
      height?: number | null
    } | null
    if (!media || String(media.ownerUserId ?? '') !== ownerUserId) throw new Error('ATTACHMENT_NOT_OWNED')
    const mimeType = typeof media.mimeType === 'string' ? media.mimeType.toLowerCase() : ''
    const filesize = media.filesize
    const filename = typeof media.filename === 'string' ? media.filename : ''
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(mimeType) ||
      typeof filesize !== 'number' || !Number.isSafeInteger(filesize) || filesize < 1 || filesize > 20 * 1024 * 1024 ||
      !filename || filename.length > 255) throw new Error('ATTACHMENT_INVALID')
    attachments.push({
      mediaId: String(media.id ?? mediaId),
      filename,
      mimeType,
      filesize,
      width: typeof media.width === 'number' && Number.isSafeInteger(media.width) ? media.width : null,
      height: typeof media.height === 'number' && Number.isSafeInteger(media.height) ? media.height : null,
    })
  }
  return attachments
}


export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { conversationId } = await context.params
    if (!conversationId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid conversation id')
    const url = new URL(request.url)
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/messages' + (url.search || ''),
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { conversationId } = await context.params
    if (!conversationId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid conversation id')
    let body: unknown
    try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'body' && key !== 'attachments') ||
      (typeof (body as { body?: unknown }).body !== 'string' && (body as { body?: unknown }).body !== undefined)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid message payload')
    }
    let attachments: MessageAttachmentInput[]
    try {
      attachments = await validateOwnedMessageAttachments(request, (body as { attachments?: unknown }).attachments)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'UNAUTHENTICATED') return errorResponse(401, code, 'Authentication required')
      if (code === 'ATTACHMENT_NOT_OWNED') return errorResponse(404, 'NOT_FOUND', 'Attachment not found')
      if (code === 'ATTACHMENT_INVALID') return errorResponse(422, code, 'Attachment type or size is not supported')
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid message attachments')
    }
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/messages',
      method: 'POST',
      principal,
      body: { body: (body as { body?: unknown }).body ?? '', attachments },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
