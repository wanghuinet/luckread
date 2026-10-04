import { proxyBetterAuthOperation } from '../../../../auth/w02-auth-client'
import { TrafficLimitError, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
const error=(status:number,code:string,message:string)=>Response.json({error:{code,message,details:{}},requestId:crypto.randomUUID()},{status,headers:{'cache-control':'no-store'}})
const okPassword=(v:unknown):v is string=>typeof v==='string'&&Array.from(v).length>=15&&Array.from(v).length<=128
export async function POST(request:Request):Promise<Response>{
  if(!request.headers.get('Idempotency-Key')?.trim())return error(400,'IDEMPOTENCY_KEY_REQUIRED','Idempotency-Key is required')
  try{await enforceW01WriteRateLimit(request)}catch(e){if(e instanceof TrafficLimitError)return rateLimitResponse(request);return error(503,'SERVICE_UNAVAILABLE','Password change service unavailable')}
  let body:{currentPassword?:unknown;newPassword?:unknown}
  try{body=await request.json() as {currentPassword?:unknown;newPassword?:unknown}}catch{return error(422,'VALIDATION_FAILED','Invalid password change request')}
  if(!okPassword(body.currentPassword)||!okPassword(body.newPassword))return error(422,'VALIDATION_FAILED','Password does not satisfy the canonical length policy')
  return proxyBetterAuthOperation(request,'/change-password','POST',{currentPassword:body.currentPassword,newPassword:body.newPassword,revokeOtherSessions:true})
}
