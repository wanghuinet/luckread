import { callW08Creator, creatorServiceUnavailable } from '../../../../../auth/w08-creator-client.js'

export async function POST(request: Request): Promise<Response> {
  try {
    return await callW08Creator(request, '/api/v1/admin/creator-scopes', 'POST')
  } catch (error) {
    return creatorServiceUnavailable(error)
  }
}
