import { proxyW02Registration } from '../../../auth/w02-auth-client'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'
const error=(status:number,code:string,message:string)=>Response.json({error:{code,message,details:{}},requestId:crypto.randomUUID()},{status,headers:{'cache-control':'no-store'}})
export async function POST(request:Request):Promise<Response>{
  try{const ip=request.headers.get('cf-connecting-ip')?.trim()||'unknown';await enforceAuthRateLimit(request,'AUTH_REGISTER_LIMITER',['ip:'+ip])}
  catch(e){if(e instanceof TrafficLimitError)return rateLimitResponse(request);return error(503,'SERVICE_UNAVAILABLE','Registration service unavailable')}
  const key=request.headers.get('Idempotency-Key')?.trim()||''
  if(!key||key.length>255)return error(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key is required')
  return proxyW02Registration(request)
}
