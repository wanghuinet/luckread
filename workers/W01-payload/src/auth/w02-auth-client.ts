import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
type W02Env = { W02_AUTH?: W02ServiceBinding; W02_AUTH_LOCAL_URL?: string }

const getEnv = async (): Promise<W02Env> => {
  const context = await getCloudflareContext({ async: true })
  return context.env as unknown as W02Env
}
const forwardHeaders = (request: Request) => {
  const headers = new Headers(request.headers)
  headers.set('x-luckread-public-origin', new URL(request.url).origin)
  headers.delete('host')
  headers.delete('content-length')
  return headers
}
const send = async (request: Request, path: string, method = request.method, body?: unknown, preserveOriginalBody = false): Promise<Response> => {
  const env = await getEnv()
  const localBase = env.W02_AUTH_LOCAL_URL?.trim()
  const service = env.W02_AUTH
  if (!localBase && !service) throw new Error('W02 identity service is unavailable')
  const headers = forwardHeaders(request)
  let payload: BodyInit | undefined
  if (preserveOriginalBody && method !== 'GET' && method !== 'HEAD') payload = await request.arrayBuffer()
  else if (body !== undefined) { headers.set('content-type','application/json; charset=utf-8'); payload = JSON.stringify(body) }
  const target = localBase ? new URL(path, localBase.endsWith('/') ? localBase : localBase + '/') : new URL('https://luckread-w02.internal' + path)
  return localBase ? fetch(new Request(target,{method,headers,body:payload})) : service!.fetch(new Request(target,{method,headers,body:payload}))
}
const jsonCall = async <T>(request: Request, path: string, method='GET', body?: unknown): Promise<T> => {
  const response=await send(request,path,method,body)
  const raw=await response.text()
  let parsed: unknown=null
  try{parsed=raw?JSON.parse(raw):null}catch{}
  if(!response.ok)throw new Error('W02 request failed: '+response.status)
  return parsed as T
}
export async function proxyBetterAuthRequest(request: Request): Promise<Response> {
  const url=new URL(request.url)
  const suffix=url.pathname.slice('/api/auth'.length)||'/'
  return send(request,'/internal/better-auth'+suffix+url.search,request.method,undefined,true)
}
export async function proxyBetterAuthOperation(request: Request,path:string,method:'GET'|'POST',body?:unknown):Promise<Response>{
  return send(request,'/internal/better-auth'+path,method,body)
}
export async function proxyW02Registration(request: Request):Promise<Response>{
  return send(request,'/internal/auth/register','POST',undefined,true)
}
type BetterAuthSessionPayload = {
  user?: {
    id?: string
    name?: string | null
    email?: string | null
    displayName?: string | null
    accountState?: string | null
  }
  session?: { id?: string }
} | null

export type BetterAuthSessionItem = {
  id: string
  token: string
  userAgent?: string | null
  ipAddress?: string | null
  createdAt: string
  updatedAt?: string | null
  expiresAt: string
}

export async function getBetterAuthSession(request:Request):Promise<BetterAuthSessionPayload>{return jsonCall<BetterAuthSessionPayload>(request,'/internal/auth/session','GET')}
export async function listBetterAuthSessions(request:Request):Promise<BetterAuthSessionItem[]>{return jsonCall<BetterAuthSessionItem[]>(request,'/internal/auth/sessions','GET')}
export async function revokeBetterAuthSession(request:Request,token:string):Promise<void>{await jsonCall<null>(request,'/internal/auth/sessions/revoke','POST',{token})}
