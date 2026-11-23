import { describe, expect, it, vi } from 'vitest'
import worker, { type W11PostgresEnv } from './worker.js'
import type { AnalyticsPostgresPool, AnalyticsPostgresQueryResult } from './analytics-postgres-store.js'

type SchemaRow = { type: string; name: string; sql?: string | null }
const schemaRows: SchemaRow[] = [
  { type: 'table', name: 'analytics_event_dedupe', sql: "CHECK (source_worker IN ('W01','W03','W05')) CHECK (projection_status IN ('PENDING','APPLIED','LATE'))" },
  ...['analytics_content_hourly','analytics_creator_hourly','analytics_rollup_watermark','analytics_reconciliation_status','analytics_projection_rebuild_state'].map(name=>({type:'table',name})),
  ...['analytics_event_dedupe_ingested_at_idx','analytics_event_dedupe_occurred_at_idx','analytics_event_dedupe_hour_start_idx','analytics_event_dedupe_pending_idx','analytics_content_hourly_content_time_idx','analytics_content_hourly_content_id_time_idx','analytics_content_hourly_time_idx','analytics_creator_hourly_creator_time_idx'].map(name=>({type:'index',name})),
]
function environment(rows: SchemaRow[] = schemaRows, ingestEnabled = 'false') {
 const query=vi.fn(async (sql:string):Promise<AnalyticsPostgresQueryResult<any>>=>({rows:sql.includes('information_schema.tables')?rows:([{ok:1}]),rowCount:1}))
 const pool={query,connect:vi.fn()} as unknown as AnalyticsPostgresPool
 return {env:{W11_POSTGRES:pool,W11_ANALYTICS_INGEST_ENABLED:ingestEnabled} satisfies W11PostgresEnv,query}
}
const trustedHeaders={'Content-Type':'application/json','X-LuckRead-Caller':'W01','X-LuckRead-Transport-Version':'1.0','X-LuckRead-Correlation-Id':'corr_route_000001'}
const event={eventId:'evt_route_0001',dedupeKey:'dedupe_route_0001',eventName:'content_open',occurredAt:new Date(Date.now()-60_000).toISOString(),sessionId:'session_route_01',contentId:'content_route_01',contentType:'article'}
describe('W11 native PostgreSQL runtime',()=>{
 it('health probes PostgreSQL',async()=>{const {env,query}=environment();const r=await worker.fetch(new Request('https://w11/healthz'),env);expect(r.status).toBe(200);expect(await r.json()).toEqual({worker:'W11',status:'ok',database:'reachable'});expect(query).toHaveBeenCalledWith('SELECT 1::int AS ok',undefined)})
 it('readiness requires all schema objects and source/projection constraints',async()=>{const {env,query}=environment();const r=await worker.fetch(new Request('https://w11/readyz'),env);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({worker:'W11',status:'ready',schema:'ready'});expect(query.mock.calls.some(([sql])=>String(sql).includes('sqlite_master'))).toBe(false)})
 it('fails closed when late-event schema constraints are absent',async()=>{const rows=schemaRows.map(x=>x.name==='analytics_event_dedupe'?{...x,sql:"CHECK (source_worker IN ('W01','W03','W05')) CHECK (projection_status IN ('PENDING','APPLIED'))"}:x);const {env}=environment(rows);const r=await worker.fetch(new Request('https://w11/readyz'),env);expect(r.status).toBe(503);expect(await r.json()).toMatchObject({status:'not_ready',schema:'incomplete'})})
 it('rejects ingestion until explicit admission without attempting persistence',async()=>{const {env,query}=environment();const r=await worker.fetch(new Request('https://w11/internal/analytics/events',{method:'POST',headers:trustedHeaders,body:JSON.stringify({events:[event]})}),env);expect(r.status).toBe(503);expect(await r.json()).toMatchObject({error:{code:'ANALYTICS_INGEST_NOT_ADMITTED'}});expect(query).toHaveBeenCalledTimes(0)})
 it('rejects missing internal transport provenance',async()=>{const {env,query}=environment();const r=await worker.fetch(new Request('https://w11/internal/analytics/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[event]})}),env);expect(r.status).toBe(404);expect(query).not.toHaveBeenCalled()})
 it('rejects malformed or oversized batches before database work',async()=>{const {env,query}=environment();const r=await worker.fetch(new Request('https://w11/internal/analytics/events',{method:'POST',headers:trustedHeaders,body:JSON.stringify({events:Array.from({length:91},(_,i)=>({...event,eventId:'evt_'+String(i).padStart(8,'0'),dedupeKey:'dedupe_'+String(i).padStart(8,'0')}))})}),env);expect(r.status).toBe(422);expect(query).not.toHaveBeenCalled()})
 it('keeps unadmitted read endpoints closed',async()=>{const {env,query}=environment();const r=await worker.fetch(new Request('https://w11/api/analytics/creators'),env);expect(r.status).toBe(404);expect(query).not.toHaveBeenCalled()})
 it('rejects non-GET health/readiness requests',async()=>{const {env,query}=environment();for(const path of ['/healthz','/readyz']){const r=await worker.fetch(new Request('https://w11'+path,{method:'POST'}),env);expect(r.status).toBe(404)}expect(query).not.toHaveBeenCalled()})
})
