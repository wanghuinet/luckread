import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildW07D104RevenueCatMigration } from './generate-w07-revenuecat-webhook-postgres-migration.mjs'
const dir=path.dirname(fileURLToPath(import.meta.url))
const artifact=path.resolve(dir,'../../src/neon-postgres-migrations-d1-04/0004_w07_d1_04_revenuecat_webhook_inbox.sql')
test('PAY-005 migration is deterministic and matches committed PostgreSQL artifact',()=>{
 const a=buildW07D104RevenueCatMigration(),b=buildW07D104RevenueCatMigration()
 assert.equal(a.migration,b.migration);assert.equal(a.migration,readFileSync(artifact,'utf8'))
 assert.deepEqual(a.contract.schema.totals,{tables:2,explicitIndexes:3,triggers:7,triggerFunctions:1,foreignKeys:0})
 assert.deepEqual(a.contract.schema.cumulativeAfterThisSlice,{tables:12,explicitIndexes:25,triggers:56,triggerFunctions:4,foreignKeys:0})
 for(const v of Object.values(a.hashes))assert.match(v,/^[a-f0-9]{64}$/)
})
test('PAY-005 preserves first receipt uniqueness and separates payload conflicts from Hyperswitch',()=>{
 const sql=buildW07D104RevenueCatMigration().migration
 assert.match(sql,/UNIQUE \(app_id,event_id\)/)
 assert.match(sql,/UNIQUE \(app_id,event_id,incoming_payload_sha256\)/)
 assert.match(sql,/OLD.state <> 'RECEIVED'/)
 assert.match(sql,/NEW.occurrence_count <> OLD.occurrence_count \+ 1/)
 assert.match(sql,/payment_provider_events remains Hyperswitch-only/)
 assert.ok(!/CREATE TABLE (refunds|billing_documents|payment_method_revocation_requests) \(/.test(sql))
})
test('PAY-005 generator fails closed when an admitted dependency is missing',()=>{
 assert.throws(()=>buildW07D104RevenueCatMigration({readSource:()=>null}),/Missing required W07 D1-04 RevenueCat source/)
})
