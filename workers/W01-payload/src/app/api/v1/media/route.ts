import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'

/**
 * Stable v1 upload entry for clients.
 *
 * The canonical media implementation remains Payload Media + R2. This route
 * only normalizes the public URL to Payload's existing /api/media upload
 * handler; it does not introduce a second media authority or storage path.
 */
export async function POST(request: Request): Promise<Response> {
  const target = new URL('/api/media', request.url)
  return payloadMediaPost(new Request(target, request.clone()))
}
