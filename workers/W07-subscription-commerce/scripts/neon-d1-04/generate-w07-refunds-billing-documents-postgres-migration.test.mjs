import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildW07D104RefundsBillingMigration } from './generate-w07-refunds-billing-documents-postgres-migration.mjs'

test('PAY-006 builds a deterministic PostgreSQL 18 translation with source inventories',()=>{
 const first=buildW07D104RefundsBillingMigration()
 const second=buildW07D104RefundsBillingMigration()
 assert.equal(first.migration,second.migration)
 assert.equal(first.contract.schema.totals.tables,2)
 assert.equal(first.contract.schema.totals.explicitIndexes,4)
 assert.equal(first.contract.schema.totals.triggers,9)
 assert.equal(first.contract.schema.cumulativeAfterThisSlice.tables,14)
 assert.equal(first.contract.schema.cumulativeAfterThisSlice.explicitIndexes,29)
 assert.equal(first.contract.schema.cumulativeAfterThisSlice.triggers,65)
 assert.match(first.migration,/FOR UPDATE/)
 assert.match(first.migration,/uq_refunds_customer_idempotency/)
 assert.match(first.migration,/billing_documents_source_guard/)
 assert.doesNotMatch(first.migration,/\\{\\{[A-Z0-9_]+\\}\\}/)
 assert.doesNotMatch(first.migration,/CREATE TABLE payment_method_revocation_requests/i)
 assert.doesNotMatch(first.migration,/FOREIGN KEY/i)
})

test('PAY-006 fails closed when the source provider boundary changes',()=>{
 const sourcePath='workers/W07-subscription-commerce/migrations-d1-04/0006_refunds_billing_documents.sql'
 assert.throws(()=>buildW07D104RefundsBillingMigration({
  readSource(file){
   const value=readFileSync(new URL('../../../../'+file,import.meta.url),'utf8')
   return file===sourcePath?value.replace("provider = 'hyperswitch'","provider = 'other-provider'"):value
  }
 }),/provider, lifecycle or billing guards/)
})
