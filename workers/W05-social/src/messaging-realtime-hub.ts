/// <reference types="@cloudflare/workers-types" />
/** Ephemeral typing-state coordinator. Caller MUST validate principal and membership before forwarding. */
export class MessagingRealtimeHub {
 private readonly typing = new Map<string, number>()
 constructor(private readonly state: DurableObjectState) {}
 async fetch(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed',{status:405})
  let body: unknown; try { body=await request.json() } catch { return new Response('Invalid JSON',{status:400}) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response('Invalid payload',{status:400})
  const p=body as {userId?:unknown;typing?:unknown}
  if(typeof p.userId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(p.userId)||typeof p.typing!=='boolean') return new Response('Invalid payload',{status:422})
  const now=Date.now(); if(p.typing)this.typing.set(p.userId,now+5000);else this.typing.delete(p.userId)
  this.prune(now); await this.schedule(); return Response.json({activeUserIds:[...this.typing.keys()]},{headers:{'cache-control':'no-store'}})
 }
 async alarm():Promise<void>{this.prune(Date.now());await this.schedule()}
 private prune(now:number):void{for(const [id,expiry] of this.typing)if(expiry<=now)this.typing.delete(id)}
 private async schedule():Promise<void>{const next=Math.min(...this.typing.values());if(Number.isFinite(next))await this.state.storage.setAlarm(next);else await this.state.storage.deleteAlarm()}
}
