import { handleBetterAuth } from '../../../../auth/better-auth'

export async function GET(request: Request): Promise<Response> {
  return handleBetterAuth(request)
}

export async function POST(request: Request): Promise<Response> {
  return handleBetterAuth(request)
}
