import { proxyBetterAuthOperation } from '../../../auth/w02-auth-client'
import { TrafficLimitError, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
export async function POST(request:Request):Promise<Response>{
  try{await enforceW01WriteRateLimit(request)}
  catch(e){if(e instanceof TrafficLimitError)return rateLimitResponse(request);return Response.json({error:{code:'SERVICE_UNAVAILABLE',message:'Authentication service unavailable'}},{status:503,headers:{'cache-control':'no-store'}})}
  return proxyBetterAuthOperation(request,'/sign-out','POST',{})
}
