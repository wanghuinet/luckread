import { proxyBetterAuthRequest } from '../../../../auth/w02-auth-client'

export async function GET(request: Request): Promise<Response> {
  return proxyBetterAuthRequest(request)
}

export async function POST(request: Request): Promise<Response> {
  return proxyBetterAuthRequest(request)
}
