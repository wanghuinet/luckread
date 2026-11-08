import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildW07D104RenewalCyclesMigration } from './generate-w07-renewal-cycles-postgres-migration.mjs'
const dir=path.dirname(fileURLToPath(import.meta.url))
const artifact=path.resolve(dir,'../../src/neon-postgres-migrations-d1-04/0003_w07_d1_04_renewal_cycles.sql')
test('PAY-004 migration is deterministic and matches the committed PostgreSQL artifact',()=>{
 const a=buildW07D104RenewalCyclesMigration(),b=buildW07D104RenewalCyclesMigration()
 assert.equal(a.migration,b.migration);assert.equal(a.migration,readFileSync(artifact,'utf8'))
 assert.deepEqual(a.contract.schema.totals,{tables:2,explicitIndexes:4,triggers:13,triggerFunctions:1,foreignKeys:0})
 assert.deepEqual(a.contract.schema.cumulativeAfterThisSlice,{tables:10,explicitIndexes:22,triggers:49,triggerFunctions:3,foreignKeys:0})
 for(const value of Object.values(a.hashes))assert.match(value,/^[a-f0-9]{64}$/)
})
test('PAY-004 is additive and preserves its single scheduler control seed',()=>{
 const sql=buildW07D104RenewalCyclesMigration().migration
 assert.match(sql,/CREATE TABLE subscription_renewal_cycles/)
 assert.match(sql,/CREATE TABLE subscription_renewal_scheduler_state/)
 assert.match(sql,/subscription-renewals/)
 assert.match(sql,/m\\.status='ACTIVE'/)
 for(const name of ['revenuecat_webhook_events','revenuecat_webhook_event_conflicts','refunds','billing_documents','payment_method_revocation_requests','ledger_entries','entitlements','payment_intents','users','media'])assert.ok(!sql.includes('CREATE TABLE '+name+' ('))
})
test('PAY-004 generator fails closed when any dependency is unavailable',()=>{
 assert.throws(()=>buildW07D104RenewalCyclesMigration({readSource:()=>null}),/Missing required W07 D1-04 renewal-cycle source/)
})
