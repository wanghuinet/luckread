import { callW08Creator, creatorServiceUnavailable } from '../../../../../auth/w08-creator-client.js'

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    return await callW08Creator(request, '/api/v1/admin/creator-applications' + (url.search || ''), 'GET')
  } catch (error) {
    return creatorServiceUnavailable(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await callW08Creator(request, '/api/v1/admin/creator-applications/decision', 'POST')
  } catch (error) {
    return creatorServiceUnavailable(error)
  }
}
