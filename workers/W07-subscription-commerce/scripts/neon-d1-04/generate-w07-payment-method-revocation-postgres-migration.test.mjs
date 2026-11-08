import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildW07D104PaymentMethodRevocationMigration } from './generate-w07-payment-method-revocation-postgres-migration.mjs'

test('PAY-007 builds a deterministic PostgreSQL 18 translation with the full cumulative schema',()=>{
 const first=buildW07D104PaymentMethodRevocationMigration()
 const second=buildW07D104PaymentMethodRevocationMigration()
 assert.equal(first.migration,second.migration)
 assert.equal(first.contract.schema.totals.tables,1)
 assert.equal(first.contract.schema.totals.explicitIndexes,2)
 assert.equal(first.contract.schema.totals.triggers,7)
 assert.equal(first.contract.schema.cumulativeAfterThisSlice.tables,15)
 assert.equal(first.contract.schema.cumulativeAfterThisSlice.explicitIndexes,31)
 assert.equal(first.contract.schema.cumulativeAfterThisSlice.triggers,72)
 assert.match(first.migration,/DROP TRIGGER IF EXISTS payment_provider_events_terminal_immutable/)
 assert.match(first.migration,/OLD.state IN \('APPLIED','REJECTED'\)/)
 assert.match(first.migration,/OLD.event_type IN \('mandate_active','mandate_revoked'\)/)
 assert.match(first.migration,/NEW.processed_at IS NULL/)
 assert.match(first.migration,/payment_method_revocation_request_completion_guard/)
 assert.doesNotMatch(first.migration,/\\bFOREIGN\\s+KEY\\b/i)
 assert.doesNotMatch(first.migration,/\\{\\{[A-Z0-9_]+\\}\\}/)
})

test('PAY-007 fails closed if mandate receipt identity replay rules are weakened',()=>{
 const sourcePath='workers/W07-subscription-commerce/migrations-d1-04/0007_payment_method_revocation_requests.sql'
 assert.throws(()=>buildW07D104PaymentMethodRevocationMigration({
  readSource(file){
   const value=readFileSync(new URL('../../../../'+file,import.meta.url),'utf8')
   return file===sourcePath?value.replace("OLD.state IN ('APPLIED','REJECTED')","OLD.state IN ('APPLIED')"):value
  }
 }),/mandate reconciliation replay source guard is incomplete/)
})

test('PAY-007 fails closed if either renewal read stops consulting pending revocations',()=>{
 const runtimePath='workers/W07-subscription-commerce/src/renewal-runtime.ts'
 assert.throws(()=>buildW07D104PaymentMethodRevocationMigration({
  readSource(file){
   const value=readFileSync(new URL('../../../../'+file,import.meta.url),'utf8')
   return file===runtimePath?value.replaceAll("r.status <> 'COMPLETED'","r.status = 'COMPLETED'"):value
  }
 }),/W07 renewal runtime lost the pending-revocation block/)
})
