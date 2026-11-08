#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const scriptPath=fileURLToPath(import.meta.url)
const root=path.resolve(path.dirname(scriptPath),'../..')
const repo=path.resolve(root,'../..')
const p={
 contract:'contracts/database/neon-d1-04-w07-payment-method-revocation-schema.v1.json',
 base:'contracts/database/neon-d1-04-w07-order-payment-schema.v1.json',
 source:'workers/W07-subscription-commerce/migrations-d1-04/0007_payment_method_revocation_requests.sql',
 order:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql',
 mandate:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0002_w07_d1_04_saved_methods_mandates.sql',
 renewal:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0003_w07_d1_04_renewal_cycles.sql',
 revenuecat:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0004_w07_d1_04_revenuecat_webhook_inbox.sql',
 refunds:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0005_w07_d1_04_refunds_billing_documents.sql',
 renewalRuntime:'workers/W07-subscription-commerce/src/renewal-runtime.ts',
 ledger:'contracts/database/neon-schema-migration-ledger.v1.json',
 boundary:'contracts/transport/worker-d1-access-boundary.v1.json',
 template:'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-payment-method-revocation-postgres.sql',
 output:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0006_w07_d1_04_payment_method_revocation.sql',
}
const tables=['payment_method_revocation_requests']
const indexes=['ix_payment_method_revocation_status','ux_payment_method_revocation_customer_idempotency']
const triggers=[
 'payment_method_revocation_request_requires_saved_method',
 'payment_method_revocation_request_identity_immutable',
 'payment_method_revocation_request_version_guard',
 'payment_method_revocation_request_transition_guard',
 'payment_method_revocation_request_provider_deleted_immutable',
 'payment_method_revocation_request_retained',
 'payment_method_revocation_request_completion_guard',
]
function required(file,reader){const value=reader(file);if(typeof value!=='string')throw new Error('Missing required W07 D1-04 revocation source: '+file);return value}
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex')
const inventory=(sql,re)=>[...sql.matchAll(re)].map(x=>x[1]).sort()
function same(actual,expected,label){if(JSON.stringify(actual)!==JSON.stringify([...expected].sort()))throw new Error(label+' source inventory drift: '+JSON.stringify(actual))}
const schemaProjection=c=>({id:c.$id,version:c.version,target:{domainId:c.target?.domainId,databaseName:c.target?.databaseName,cloudflareD1DatabaseUuid:c.target?.cloudflareD1DatabaseUuid,postgresMajor:c.target?.postgresMajor},primaryOwner:c.primaryOwner,dependencies:c.dependencies,scope:c.scope,schema:{tables:c.schema?.tables,explicitIndexNames:c.schema?.explicitIndexNames,triggerNames:c.schema?.triggerNames,modifiedExistingTriggerNames:c.schema?.modifiedExistingTriggerNames,totals:c.schema?.totals,cumulativeAfterThisSlice:c.schema?.cumulativeAfterThisSlice},postgresMappings:c.postgresMappings})
const baseProjection=c=>({
 contractId:c.$id,
 version:c.version,
 target:{domainId:c.target?.domainId,databaseName:c.target?.databaseName,cloudflareD1DatabaseUuid:c.target?.cloudflareD1DatabaseUuid,postgresMajor:c.target?.postgresMajor},
 primaryOwner:c.primaryOwner?.worker,
 // Freeze the PAY-006 cumulative prefix so this migration is stable if later slices append.
 sourceMigrations:c.scope?.includedSourceMigrations?.slice(0,6),
 tables:Object.fromEntries(Object.entries(c.schema?.tables??{}).slice(0,14)),
 explicitIndexNames:c.schema?.explicitIndexNames?.slice(0,29),
 triggerNames:c.schema?.triggerNames?.slice(0,65),
 totals:{tables:14,explicitIndexes:29,triggers:65,triggerFunctions:5,foreignKeys:0},
 sliceTotals:Object.fromEntries(Object.entries(c.schema?.sliceTotals??{}).slice(0,5)),
})
function renewalRevocationGuardProjection(runtime){
 const names=['readActiveMandate','isExactMandateActive']
 const fragments=names.map(name=>{
  const match=runtime.match(new RegExp('async function '+name+'\\([\\s\\S]*?\\n}'))
  if(!match||!match[0].includes('payment_method_revocation_requests')||!match[0].includes("r.status <> 'COMPLETED'"))throw new Error('W07 renewal runtime lost the pending-revocation block in '+name)
  return match[0]
 })
 return fragments.join('\n-- PAY-007 renewal guard boundary\n')
}
export function buildW07D104PaymentMethodRevocationMigration({readSource=(file)=>{try{return readFileSync(path.join(repo,file),'utf8')}catch{return null}}}={}){
 const c=JSON.parse(required(p.contract,readSource)),b=JSON.parse(required(p.base,readSource))
 const source=required(p.source,readSource)
 const order=required(p.order,readSource),mandate=required(p.mandate,readSource),renewal=required(p.renewal,readSource)
 const revenuecat=required(p.revenuecat,readSource),refunds=required(p.refunds,readSource)
 const runtime=required(p.renewalRuntime,readSource),renewalGuard=renewalRevocationGuardProjection(runtime)
 const ledgerText=required(p.ledger,readSource),boundaryText=required(p.boundary,readSource),template=required(p.template,readSource)
 const ledger=JSON.parse(ledgerText),boundary=JSON.parse(boundaryText)
 if(c.target?.domainId!=='D1-04'||c.target?.databaseName!=='luckread_finance'||c.target?.postgresMajor!==18||c.target?.cloudflareD1DatabaseUuid!=='9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'||c.target?.remoteSchemaApplied!==false||c.target?.productionCutoverAuthorized!==false||c.dependencies?.previousMigrationId!=='0005_w07_d1_04_refunds_billing_documents')throw new Error('PAY-007 target/safety/predecessor contract drift')
 if(c.primaryOwner?.worker!=='W07'||c.primaryOwner?.feature!=='PAY-007'||b.primaryOwner?.worker!=='W07'||b.target?.databaseName!=='luckread_finance'||b.schema?.totals?.tables<14||b.schema?.totals?.explicitIndexes<29||b.schema?.totals?.triggers<65||b.schema?.totals?.triggerFunctions<5||b.schema?.totals?.foreignKeys!==0||c.dependencies?.previousSchemaTotals?.tables!==14||c.dependencies?.previousSchemaTotals?.explicitIndexes!==29||c.dependencies?.previousSchemaTotals?.triggers!==65||c.dependencies?.previousSchemaTotals?.triggerFunctions!==5||c.dependencies?.previousSchemaTotals?.foreignKeys!==0)throw new Error('PAY-007 cumulative schema or predecessor totals are not admitted')
 if(!b.scope?.includedSourceMigrations?.includes(c.scope?.includedSourceMigration)||!b.schema?.tables?.saved_payment_methods||!b.schema?.tables?.payment_mandates||!b.schema?.tables?.subscription_renewal_cycles||!b.schema?.cumulativeSlices?.some(x=>x.migrationId==='0005_w07_d1_04_refunds_billing_documents'&&x.status==='LOCAL_POSTGRES18_REHEARSAL_PASSED')||!b.schema?.sliceTotals?.refundsBillingDocuments||!ledger.domainOwners?.['D1-04']?.includes('W07')||boundary.physicalD1Registry?.['D1-04']!=='9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'||!boundary.workers?.W07?.allowedDomains?.includes('D1-04'))throw new Error('PAY-007 cumulative PAY-006 evidence or W07 ownership is not admitted')
 same(inventory(source,/CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z0-9_]+)/gi),tables,'PAY-007 table')
 same(inventory(source,/CREATE (?:UNIQUE )?INDEX\s+([A-Za-z0-9_]+)/gi),indexes,'PAY-007 index')
 const sourceTriggers=inventory(source,/CREATE TRIGGER\\s+([A-Za-z0-9_]+)/gi)\n if(!sourceTriggers.includes('payment_provider_events_terminal_immutable'))throw new Error('PAY-007 must replace the existing mandate terminal receipt trigger')\n same(sourceTriggers.filter(name=>name!=='payment_provider_events_terminal_immutable'),triggers,'PAY-007 new trigger')
 if(!source.includes('DROP TRIGGER IF EXISTS payment_provider_events_terminal_immutable')||!source.includes("OLD.state IN ('APPLIED','REJECTED')")||!source.includes("OLD.state = 'RECONCILIATION_REQUIRED'")||!source.includes("OLD.event_type IN ('mandate_active','mandate_revoked')")||!source.includes("NEW.state = 'RECEIVED'")||!source.includes('NEW.processed_at IS NULL')||!source.includes('NEW.outcome_code IS NULL'))throw new Error('PAY-007 mandate reconciliation replay source guard is incomplete')
 if(!source.includes('FOREIGN KEY (saved_payment_method_id) REFERENCES saved_payment_methods')||!source.includes('payment_method_revocation_request_completion_guard')||!source.includes('NEW.provider_method_deleted_at IS NULL')||!source.includes("m.status NOT IN ('REVOKED', 'FAILED', 'EXPIRED')"))throw new Error('PAY-007 saved-method relationship or completion invariants are incomplete')
 if(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:entitlements|ledger_entries|payment_intents|users|media)\b/i.test(source))throw new Error('PAY-007 contains cross-domain tables')
 if(c.scope?.includedTables?.join(',')!==tables.join(',')||c.scope?.deferredTables?.length!==0||c.schema?.totals?.tables!==1||c.schema?.totals?.explicitIndexes!==2||c.schema?.totals?.triggers!==7||c.schema?.totals?.triggerFunctions!==1||c.schema?.totals?.foreignKeys!==0||c.schema?.cumulativeAfterThisSlice?.tables!==15||c.schema?.cumulativeAfterThisSlice?.explicitIndexes!==31||c.schema?.cumulativeAfterThisSlice?.triggers!==72||c.schema?.cumulativeAfterThisSlice?.triggerFunctions!==6||c.schema?.cumulativeAfterThisSlice?.foreignKeys!==0)throw new Error('PAY-007 slice inventory drift')
 const hashes={
  W07_PAYMENT_METHOD_REVOCATION_SOURCE_SHA256:hash(source),
  PREVIOUS_ORDER_PAYMENT_SCHEMA_SHA256:hash(order),
  PREVIOUS_SAVED_METHODS_MANDATES_SCHEMA_SHA256:hash(mandate),
  PREVIOUS_RENEWAL_CYCLES_SCHEMA_SHA256:hash(renewal),
  PREVIOUS_REVENUECAT_WEBHOOK_SCHEMA_SHA256:hash(revenuecat),
  PREVIOUS_REFUNDS_BILLING_SCHEMA_SHA256:hash(refunds),
  PAYMENT_METHOD_REVOCATION_SCHEMA_CONTRACT_SEMANTIC_SHA256:hash(JSON.stringify(schemaProjection(c))),
  BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256:hash(JSON.stringify(baseProjection(b))),
  W07_RENEWAL_RUNTIME_REVOCATION_GUARD_SHA256:hash(renewalGuard),
  D1_04_OWNER_LEDGER_CONTRACT_SHA256:hash(ledgerText),
  D1_04_OWNER_BOUNDARY_CONTRACT_SHA256:hash(boundaryText),
 }
 let sql=template
 for(const [key,value] of Object.entries(hashes))sql=sql.replaceAll('{{'+key+'}}',value)
 if(/\{\{[A-Z0-9_]+\}\}/.test(sql))throw new Error('Unresolved PAY-007 checksum placeholder')
 return {migration:sql,hashes,contract:c}
}
function run(){
 const result=buildW07D104PaymentMethodRevocationMigration(),file=path.join(repo,p.output)
 const actual=(()=>{try{return readFileSync(file,'utf8')}catch{return null}})()
 if(process.argv.includes('--write')){
  writeFileSync(file,result.migration)
  console.log('NEON_D1_04_W07_PAYMENT_METHOD_REVOCATION_MIGRATION_WRITTEN '+JSON.stringify({output:p.output,hashes:result.hashes,bytes:Buffer.byteLength(result.migration)}))
  return
 }
 if(actual!==result.migration)throw new Error('Committed PAY-007 PostgreSQL artifact drift; regenerate with --write and review')
 console.log('NEON_D1_04_W07_PAYMENT_METHOD_REVOCATION_MIGRATION_CURRENT '+JSON.stringify({output:p.output,hashes:result.hashes,bytes:Buffer.byteLength(result.migration),totals:result.contract.schema.totals,remoteConnectionAttempted:false,remoteDdlExecuted:false}))
}
if(process.argv[1]&&path.resolve(process.argv[1])===scriptPath){try{run()}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}}
