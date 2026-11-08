#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const scriptPath=fileURLToPath(import.meta.url)
const root=path.resolve(path.dirname(scriptPath),'../..')
const repo=path.resolve(root,'../..')
const p={
 contract:'contracts/database/neon-d1-04-w07-refunds-billing-documents-schema.v1.json',
 base:'contracts/database/neon-d1-04-w07-order-payment-schema.v1.json',
 source:'workers/W07-subscription-commerce/migrations-d1-04/0006_refunds_billing_documents.sql',
 order:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql',
 mandate:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0002_w07_d1_04_saved_methods_mandates.sql',
 renewal:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0003_w07_d1_04_renewal_cycles.sql',
 revenuecat:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0004_w07_d1_04_revenuecat_webhook_inbox.sql',
 ledger:'contracts/database/neon-schema-migration-ledger.v1.json',
 boundary:'contracts/transport/worker-d1-access-boundary.v1.json',
 template:'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-refunds-billing-documents-postgres.sql',
 output:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0005_w07_d1_04_refunds_billing_documents.sql',
}
const tables=['refunds','billing_documents']
const indexes=['ix_refunds_customer_created','ix_refunds_payment_created','ix_refunds_status_updated','ix_billing_documents_customer_issued']
const triggers=['refunds_require_captured_payment','refunds_identity_immutable','refunds_version_guard','refunds_state_transition_guard','refunds_provider_timestamp_monotonic','refunds_retained','billing_documents_source_guard','billing_documents_identity_immutable','billing_documents_retained']
function required(file,reader){const value=reader(file);if(typeof value!=='string')throw new Error('Missing required W07 D1-04 refunds/billing source: '+file);return value}
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex')
const inventory=(sql,re)=>[...sql.matchAll(re)].map(x=>x[1]).sort()
function same(actual,expected,label){if(JSON.stringify(actual)!==JSON.stringify([...expected].sort()))throw new Error(label+' source inventory drift: '+JSON.stringify(actual))}
const schemaProjection=c=>({id:c.$id,version:c.version,target:{domainId:c.target?.domainId,databaseName:c.target?.databaseName,cloudflareD1DatabaseUuid:c.target?.cloudflareD1DatabaseUuid,postgresMajor:c.target?.postgresMajor},primaryOwner:c.primaryOwner,dependencies:c.dependencies,scope:c.scope,schema:{tables:c.schema?.tables,explicitIndexNames:c.schema?.explicitIndexNames,triggerNames:c.schema?.triggerNames,totals:c.schema?.totals,cumulativeAfterThisSlice:c.schema?.cumulativeAfterThisSlice},postgresMappings:c.postgresMappings})
const baseProjection=c=>({
 contractId:c.$id,
 version:c.version,
 target:{domainId:c.target?.domainId,databaseName:c.target?.databaseName,cloudflareD1DatabaseUuid:c.target?.cloudflareD1DatabaseUuid,postgresMajor:c.target?.postgresMajor},
 primaryOwner:c.primaryOwner?.worker,
 sourceMigrations:c.scope?.includedSourceMigrations?.slice(0,5),
 tables:Object.fromEntries(Object.entries(c.schema?.tables??{}).slice(0,12)),
 explicitIndexNames:c.schema?.explicitIndexNames?.slice(0,25),
 triggerNames:c.schema?.triggerNames?.slice(0,56),
 totals:{tables:12,explicitIndexes:25,triggers:56,triggerFunctions:4,foreignKeys:0},
 sliceTotals:Object.fromEntries(Object.entries(c.schema?.sliceTotals??{}).slice(0,4)),
})
export function buildW07D104RefundsBillingMigration({readSource=(file)=>{try{return readFileSync(path.join(repo,file),'utf8')}catch{return null}}}={}){
 const c=JSON.parse(required(p.contract,readSource)),b=JSON.parse(required(p.base,readSource))
 const source=required(p.source,readSource),order=required(p.order,readSource),mandate=required(p.mandate,readSource)
 const renewal=required(p.renewal,readSource),revenuecat=required(p.revenuecat,readSource)
 const ledgerText=required(p.ledger,readSource),boundaryText=required(p.boundary,readSource),template=required(p.template,readSource)
 const ledger=JSON.parse(ledgerText),boundary=JSON.parse(boundaryText)
 if(c.target?.domainId!=='D1-04'||c.target?.databaseName!=='luckread_finance'||c.target?.postgresMajor!==18||c.target?.cloudflareD1DatabaseUuid!=='9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'||c.target?.remoteSchemaApplied!==false||c.target?.productionCutoverAuthorized!==false||c.dependencies?.previousMigrationId!=='0004_w07_d1_04_revenuecat_webhook_inbox')throw new Error('PAY-006 target/safety/predecessor contract drift')
 if(c.primaryOwner?.worker!=='W07'||c.primaryOwner?.feature!=='PAY-006'||b.primaryOwner?.worker!=='W07'||b.target?.databaseName!=='luckread_finance'||b.schema?.totals?.tables<12||b.schema?.totals?.explicitIndexes<25||b.schema?.totals?.triggers<56||b.schema?.totals?.triggerFunctions<4||b.schema?.totals?.foreignKeys!==0||c.dependencies?.previousSchemaTotals?.tables!==12||c.dependencies?.previousSchemaTotals?.explicitIndexes!==25||c.dependencies?.previousSchemaTotals?.triggers!==56||c.dependencies?.previousSchemaTotals?.triggerFunctions!==4||c.dependencies?.previousSchemaTotals?.foreignKeys!==0)throw new Error('PAY-006 cumulative schema or predecessor totals are not admitted')
 if(!b.scope?.includedSourceMigrations?.includes(c.scope?.includedSourceMigration)||!b.schema?.tables?.revenuecat_webhook_events||!b.schema?.tables?.revenuecat_webhook_event_conflicts||!b.schema?.cumulativeSlices?.some(x=>x.migrationId==='0004_w07_d1_04_revenuecat_webhook_inbox'&&x.status==='LOCAL_POSTGRES18_REHEARSAL_PASSED')||!b.schema?.sliceTotals?.revenuecatWebhookInbox||!ledger.domainOwners?.['D1-04']?.includes('W07')||boundary.physicalD1Registry?.['D1-04']!=='9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'||!boundary.workers?.W07?.allowedDomains?.includes('D1-04'))throw new Error('PAY-006 cumulative PAY-005 evidence or W07 ownership is not admitted')
 same(inventory(source,/CREATE TABLE(?: IF NOT EXISTS)?\\s+([A-Za-z0-9_]+)/gi),tables,'PAY-006 table')
 same(inventory(source,/CREATE (?:UNIQUE )?INDEX\\s+([A-Za-z0-9_]+)/gi),indexes,'PAY-006 index')
 same(inventory(source,/CREATE TRIGGER\\s+([A-Za-z0-9_]+)/gi),triggers,'PAY-006 trigger')
 if(!source.includes("provider = 'hyperswitch'")||!source.includes("status <> 'FAILED'")||!source.includes("NEW.captured_amount_minor")||!source.includes("NEW.document_type = 'RECEIPT'")||!source.includes("status = 'succeeded'")||!source.includes('refunds_identity_immutable')||!source.includes('billing_documents_identity_immutable'))throw new Error('PAY-006 source money, provider, lifecycle or billing guards are missing')
 if(/CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:payment_method_revocation_requests|entitlements|ledger_entries|payment_intents|users|media)\\b/i.test(source)||/FOREIGN KEY/i.test(source))throw new Error('PAY-006 contains deferred, cross-domain or foreign-key scope')
 if(c.scope?.includedTables?.join(',')!==tables.join(',')||c.schema?.totals?.tables!==2||c.schema?.totals?.explicitIndexes!==4||c.schema?.totals?.triggers!==9||c.schema?.totals?.triggerFunctions!==1||c.schema?.totals?.foreignKeys!==0||c.schema?.cumulativeAfterThisSlice?.tables!==14||c.schema?.cumulativeAfterThisSlice?.explicitIndexes!==29||c.schema?.cumulativeAfterThisSlice?.triggers!==65||c.schema?.cumulativeAfterThisSlice?.triggerFunctions!==5||c.schema?.cumulativeAfterThisSlice?.foreignKeys!==0)throw new Error('PAY-006 slice inventory drift')
 const hashes={
  W07_REFUNDS_BILLING_SOURCE_SHA256:hash(source),
  PREVIOUS_ORDER_PAYMENT_SCHEMA_SHA256:hash(order),
  PREVIOUS_SAVED_METHODS_MANDATES_SCHEMA_SHA256:hash(mandate),
  PREVIOUS_RENEWAL_CYCLES_SCHEMA_SHA256:hash(renewal),
  PREVIOUS_REVENUECAT_WEBHOOK_SCHEMA_SHA256:hash(revenuecat),
  REFUNDS_BILLING_SCHEMA_CONTRACT_SEMANTIC_SHA256:hash(JSON.stringify(schemaProjection(c))),
  BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256:hash(JSON.stringify(baseProjection(b))),
  D1_04_OWNER_LEDGER_CONTRACT_SHA256:hash(ledgerText),
  D1_04_OWNER_BOUNDARY_CONTRACT_SHA256:hash(boundaryText),
 }
 let sql=template
 for(const [key,value] of Object.entries(hashes))sql=sql.replaceAll('{{'+key+'}}',value)
 if(/\\{\\{[A-Z0-9_]+\\}\\}/.test(sql))throw new Error('Unresolved PAY-006 checksum placeholder')
 return {migration:sql,hashes,contract:c}
}
function run(){
 const result=buildW07D104RefundsBillingMigration(),file=path.join(repo,p.output)
 const actual=(()=>{try{return readFileSync(file,'utf8')}catch{return null}})()
 if(process.argv.includes('--write')){
  writeFileSync(file,result.migration)
  console.log('NEON_D1_04_W07_REFUNDS_BILLING_MIGRATION_WRITTEN '+JSON.stringify({output:p.output,hashes:result.hashes,bytes:Buffer.byteLength(result.migration)}))
  return
 }
 if(actual!==result.migration)throw new Error('Committed PAY-006 PostgreSQL artifact drift; regenerate with --write. Expected hashes: '+JSON.stringify(result.hashes))
 console.log('NEON_D1_04_W07_REFUNDS_BILLING_MIGRATION_CURRENT '+JSON.stringify({output:p.output,hashes:result.hashes,bytes:Buffer.byteLength(result.migration),totals:result.contract.schema.totals,remoteConnectionAttempted:false,remoteDdlExecuted:false}))
}
if(process.argv[1]&&path.resolve(process.argv[1])===scriptPath){try{run()}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}}
