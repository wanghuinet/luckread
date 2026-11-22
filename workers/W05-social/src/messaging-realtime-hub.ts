/// <reference types="@cloudflare/workers-types" />
/** Ephemeral typing-state coordinator. Caller MUST validate principal and membership before forwarding. */
type TypingState=Record<string,number>
export class MessagingRealtimeHub {
 constructor(private readonly state:DurableObjectState){}
 async fetch(request:Request):Promise<Response>{
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405})
  let body:unknown;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
  if(!body||typeof body!=='object'||Array.isArray(body))return new Response('Invalid payload',{status:400})
  const p=body as {userId?:unknown;typing?:unknown}
  if(typeof p.userId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(p.userId)||typeof p.typing!=='boolean')return new Response('Invalid payload',{status:422})
  const now=Date.now(),state=await this.state.storage.get<TypingState>('typing')??{}
  for(const [id,expires] of Object.entries(state))if(expires<=now)delete state[id]
  if(p.typing)state[p.userId]=now+5000;else delete state[p.userId]
  await this.state.storage.put('typing',state)
  await this.schedule(state)
  return Response.json({activeUserIds:Object.keys(state)},{headers:{'cache-control':'no-store'}})
 }
 async alarm():Promise<void>{const state=await this.state.storage.get<TypingState>('typing')??{};for(const [id,expires] of Object.entries(state))if(expires<=Date.now())delete state[id];await this.state.storage.put('typing',state);await this.schedule(state)}
 private async schedule(state:TypingState):Promise<void>{const next=Math.min(...Object.values(state));if(Number.isFinite(next))await this.state.storage.setAlarm(next);else await this.state.storage.deleteAlarm()}
}
