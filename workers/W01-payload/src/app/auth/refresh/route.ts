import { proxyBetterAuthOperation } from '../../../auth/w02-auth-client'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'
export async function POST(request:Request):Promise<Response>{
  try{const ip=request.headers.get('cf-connecting-ip')?.trim()||'unknown';await enforceAuthRateLimit(request,'AUTH_REFRESH_LIMITER',['ip:'+ip])}
  catch(e){if(e instanceof TrafficLimitError)return rateLimitResponse(request);return Response.json({error:{code:'SERVICE_UNAVAILABLE',message:'Authentication service unavailable'}},{status:503,headers:{'cache-control':'no-store'}})}
  return proxyBetterAuthOperation(request,'/get-session','GET')
}
