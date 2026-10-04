import { proxyBetterAuthOperation } from '../../../auth/w02-auth-client'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'
const error=(status:number,code:string,message:string)=>Response.json({error:{code,message,details:{}},requestId:crypto.randomUUID()},{status,headers:{'cache-control':'no-store'}})
export async function POST(request:Request):Promise<Response>{
  try{const ip=request.headers.get('cf-connecting-ip')?.trim()||'unknown';await enforceAuthRateLimit(request,'AUTH_LOGIN_LIMITER',['ip:'+ip])}
  catch(e){if(e instanceof TrafficLimitError)return rateLimitResponse(request);return error(503,'SERVICE_UNAVAILABLE','Authentication service unavailable')}
  let body:{identity?:unknown;credential?:unknown}
  try{body=await request.json() as {identity?:unknown;credential?:unknown}}catch{return error(400,'VALIDATION_FAILED','Invalid authentication request')}
  if(typeof body.identity!=='string'||!body.identity.trim()||typeof body.credential!=='string'||!body.credential)return error(400,'VALIDATION_FAILED','Invalid authentication request')
  return proxyBetterAuthOperation(request,'/sign-in/email','POST',{email:body.identity.trim().toLowerCase(),password:body.credential})
}
