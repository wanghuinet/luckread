/// <reference types="@cloudflare/workers-types" />
/** Ephemeral typing-state coordinator. Caller MUST validate principal and membership before forwarding. */
type TypingState=Record<string,number>
type SessionData={userId:string}
export class MessagingRealtimeHub {
 private sockets=new Map<WebSocket,SessionData>()
 constructor(private readonly state:DurableObjectState){}
 async fetch(request:Request):Promise<Response>{
  if(new URL(request.url).pathname.endsWith('/connect'))return this.connect(request)
  const now=Date.now(),state=await this.state.storage.get<TypingState>('typing')??{}
  for(const [id,expires] of Object.entries(state))if(expires<=now)delete state[id]
  if(request.method==='GET'){await this.state.storage.put('typing',state);await this.schedule(state);return Response.json({activeUserIds:Object.keys(state)},{headers:{'cache-control':'no-store'}})}
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405})
  let body:unknown;try{body=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
  if(!body||typeof body!=='object'||Array.isArray(body))return new Response('Invalid payload',{status:400})
  const p=body as {userId?:unknown;typing?:unknown}
  if(typeof p.userId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(p.userId)||typeof p.typing!=='boolean')return new Response('Invalid payload',{status:422})
  if(p.typing)state[p.userId]=now+5000;else delete state[p.userId]
  await this.state.storage.put('typing',state)
  await this.schedule(state)
  return Response.json({activeUserIds:Object.keys(state)},{headers:{'cache-control':'no-store'}})
 }
 private connect(request:Request):Response {
  if(request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket upgrade required',{status:426})
  const userId=request.headers.get('X-LuckRead-Principal-User-Id')?.trim()||''
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(userId))return new Response('Unauthorized',{status:401})
  const pair=new WebSocketPair(),client=pair[0],server=pair[1]
  server.accept()
  this.sockets.set(server,{userId})
  server.addEventListener('message',event=>{if(typeof event.data==='string'&&event.data.length<=1024){try{const msg=JSON.parse(event.data);if(msg?.type==='ping')server.send(JSON.stringify({type:'pong',at:Date.now()}))}catch{/* ignore malformed frames */}}})
  server.addEventListener('close',()=>this.sockets.delete(server));server.addEventListener('error',()=>this.sockets.delete(server))
  server.send(JSON.stringify({type:'connected'}));return new Response(null,{status:101,webSocket:client})
 }
 broadcast(event:unknown):void {const payload=JSON.stringify(event);for(const socket of this.sockets.keys())try{socket.send(payload)}catch{this.sockets.delete(socket)}}
 async alarm():Promise<void>{const state=await this.state.storage.get<TypingState>('typing')??{};for(const [id,expires] of Object.entries(state))if(expires<=Date.now())delete state[id];await this.state.storage.put('typing',state);await this.schedule(state)}
 private async schedule(state:TypingState):Promise<void>{const next=Math.min(...Object.values(state));if(Number.isFinite(next))await this.state.storage.setAlarm(next);else await this.state.storage.deleteAlarm()}
}
