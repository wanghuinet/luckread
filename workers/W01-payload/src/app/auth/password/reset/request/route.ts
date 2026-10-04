import { proxyBetterAuthOperation } from '../../../../../auth/w02-auth-client'
export async function POST(request:Request):Promise<Response>{
  let body:{identifier?:unknown}
  try{body=await request.json() as {identifier?:unknown}}catch{return Response.json({error:{code:'VALIDATION_FAILED',message:'Invalid password recovery request'}},{status:422,headers:{'cache-control':'no-store'}})}
  if(typeof body.identifier!=='string'||!body.identifier.trim())return Response.json({error:{code:'VALIDATION_FAILED',message:'Invalid password recovery request'}},{status:422,headers:{'cache-control':'no-store'}})
  return proxyBetterAuthOperation(request,'/request-password-reset','POST',{email:body.identifier.trim().toLowerCase(),redirectTo:new URL('/reset-password',request.url).toString()})
}
