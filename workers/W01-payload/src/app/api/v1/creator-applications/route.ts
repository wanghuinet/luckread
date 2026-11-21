import { callW08Creator, creatorServiceUnavailable } from '../../../../auth/w08-creator-client.js'

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const path = '/api/v1/creator-applications/me' + (url.search || '')
    return await callW08Creator(request, path, 'GET')
  } catch (error) {
    return creatorServiceUnavailable(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await callW08Creator(request, '/api/v1/creator-applications', 'POST')
  } catch (error) {
    return creatorServiceUnavailable(error)
  }
}
