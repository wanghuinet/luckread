import { GET as getMedia } from '../route'

type MediaPayload = {
  id?: string | number
  url?: string | null
  mimeType?: string | null
  filename?: string | null
  filesize?: number | null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const response = await getMedia(request, context)
  if (!response.ok) return response

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return new Response(JSON.stringify({
      error: { code: 'MEDIA_RESPONSE_INVALID', message: 'Media response unavailable' },
    }), {
      status: 502,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  const envelope = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null
  const document = envelope?.doc && typeof envelope.doc === 'object' && !Array.isArray(envelope.doc)
    ? envelope.doc as MediaPayload
    : body && typeof body === 'object' && !Array.isArray(body)
      ? body as MediaPayload
      : null

  if (!document || typeof document.url !== 'string' || !document.url.trim()) {
    return new Response(JSON.stringify({
      error: { code: 'MEDIA_NOT_DELIVERABLE', message: 'Media is not currently deliverable' },
    }), {
      status: 404,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  return new Response(JSON.stringify({
    id: String(document.id ?? ''),
    url: document.url,
    mimeType: typeof document.mimeType === 'string' ? document.mimeType : null,
    filename: typeof document.filename === 'string' ? document.filename : null,
    filesize: typeof document.filesize === 'number' ? document.filesize : null,
    status: 'READY',
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
