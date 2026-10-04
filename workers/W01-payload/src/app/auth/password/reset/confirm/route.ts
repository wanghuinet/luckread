import { proxyBetterAuthOperation } from '../../../../../auth/w02-auth-client'
const okPassword=(v:unknown):v is string=>typeof v==='string'&&Array.from(v).length>=15&&Array.from(v).length<=128
export async function POST(request:Request):Promise<Response>{
  let body:{recoveryToken?:unknown;newPassword?:unknown}
  try{body=await request.json() as {recoveryToken?:unknown;newPassword?:unknown}}catch{return Response.json({error:{code:'VALIDATION_FAILED',message:'Invalid password reset request'}},{status:422,headers:{'cache-control':'no-store'}})}
  if(typeof body.recoveryToken!=='string'||!body.recoveryToken||!okPassword(body.newPassword))return Response.json({error:{code:'VALIDATION_FAILED',message:'Invalid password reset request'}},{status:422,headers:{'cache-control':'no-store'}})
  return proxyBetterAuthOperation(request,'/reset-password','POST',{token:body.recoveryToken,newPassword:body.newPassword})
}
