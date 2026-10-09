import {
  assertSocialTargetUserExists,
  callW05Social,
  resolveSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'
import { invalidatePublicFollowList } from '../../../../../../lib/public-response-cache.js'
const errorResponse=(status:number,code:string,message:string)=>Response.json({error:{code,message,details:{}},requestId:crypto.randomUUID()},{status:code==='VALIDATION_FAILED' && status===400 ? 422 : status})
async function forward(request:Request,context:{params:Promise<{targetUserId:string}>},method:string):Promise<Response>{ try { const principal=await resolveSocialPrincipal(request); if(principal instanceof Response)return principal; const {targetUserId}=await context.params; if(method!=='GET'){ const idempotencyKey=request.headers.get('Idempotency-Key')?.trim() ?? ''; if(!idempotencyKey || idempotencyKey.length > 256) return errorResponse(428,'PRECONDITION_REQUIRED','Idempotency-Key is required'); } if(method==='POST') await assertSocialTargetUserExists(targetUserId); const response=await callW05Social({request,pathname:'/internal/social/follows/'+encodeURIComponent(targetUserId),method,principal}); if(response.ok && method!=='GET'){ await Promise.all([invalidatePublicFollowList('following',principal.userId),invalidatePublicFollowList('followers',targetUserId)]) } return response } catch(error){ if(error instanceof W05SocialClientError)return errorResponse(error.status,error.code,error.message); return errorResponse(503,'SERVICE_UNAVAILABLE','Social service unavailable') } }
export async function GET(request:Request,context:{params:Promise<{targetUserId:string}>}){return forward(request,context,'GET')}
export async function POST(request:Request,context:{params:Promise<{targetUserId:string}>}){return forward(request,context,'POST')}
export async function DELETE(request:Request,context:{params:Promise<{targetUserId:string}>}){return forward(request,context,'DELETE')}