#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const scriptPath=fileURLToPath(import.meta.url)
const root=path.resolve(path.dirname(scriptPath),'../..')
const repo=path.resolve(root,'../..')
const p={
 contract:'contracts/database/neon-d1-04-w07-renewal-cycles-schema.v1.json',
 base:'contracts/database/neon-d1-04-w07-order-payment-schema.v1.json',
 source:'workers/W07-subscription-commerce/migrations-d1-04/0004_subscription_renewal_cycles.sql',
 order:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql',
 mandate:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0002_w07_d1_04_saved_methods_mandates.sql',
 ledger:'contracts/database/neon-schema-migration-ledger.v1.json',
 boundary:'contracts/transport/worker-d1-access-boundary.v1.json',
 workflow:'contracts/transport/W10-W07-membership-renewal-workflow.v1.json',
 template:'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-renewal-cycles-postgres.sql',
 output:'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0003_w07_d1_04_renewal_cycles.sql',
}
const tables=['subscription_renewal_cycles','subscription_renewal_scheduler_state']
const indexes=['ux_subscription_renewal_cycles_subscription_cycle','ux_subscription_renewal_cycles_payment','ix_subscription_renewal_cycles_state_updated','ix_subscription_renewal_cycles_subscriber_cycle']
const triggers=['subscription_renewal_cycles_initial_state_guard','subscription_renewal_cycles_identity_immutable','subscription_renewal_cycles_resolved_snapshot_immutable','subscription_renewal_cycles_version_guard','subscription_renewal_cycles_state_transition_guard','subscription_renewal_cycles_sync_state_transition_guard','subscription_renewal_cycles_order_binding_guard','subscription_renewal_cycles_payment_binding_guard','subscription_renewal_cycles_requires_active_mandate','subscription_renewal_cycles_retained','subscription_renewal_scheduler_state_identity_immutable','subscription_renewal_scheduler_state_version_guard','subscription_renewal_scheduler_state_retained']
function readRequired(file,reader){const value=reader(file);if(typeof value!=='string')throw new Error('Missing required W07 D1-04 renewal-cycle source: '+file);return value}
function hash(value){return createHash('sha256').update(value,'utf8').digest('hex')}
function inventory(sql,re){return [...sql.matchAll(re)].map(x=>x[1]).sort()}
function same(a,b,label){if(JSON.stringify(a)!==JSON.stringify([...b].sort()))throw new Error(label+' source inventory drift: '+JSON.stringify(a))}
function schemaProjection(c){return {id:c.$id,version:c.version,target:{domainId:c.target?.domainId,databaseName:c.target?.databaseName,cloudflareD1DatabaseUuid:c.target?.cloudflareD1DatabaseUuid,postgresMajor:c.target?.postgresMajor},primaryOwner:c.primaryOwner,dependencies:c.dependencies,scope:c.scope,schema:{tables:c.schema?.tables,explicitIndexNames:c.schema?.explicitIndexNames,triggerNames:c.schema?.triggerNames,totals:c.schema?.totals,cumulativeAfterThisSlice:c.schema?.cumulativeAfterThisSlice},postgresMappings:c.postgresMappings}}
function baseProjection(c){return {contractId:c.$id,version:c.version,target:{domainId:c.target?.domainId,databaseName:c.target?.databaseName,cloudflareD1DatabaseUuid:c.target?.cloudflareD1DatabaseUuid,postgresMajor:c.target?.postgresMajor},primaryOwner:c.primaryOwner?.worker,sourceMigrations:c.scope?.includedSourceMigrations,tables:c.schema?.tables,explicitIndexNames:c.schema?.explicitIndexNames,triggerNames:c.schema?.triggerNames,totals:c.schema?.totals,sliceTotals:c.schema?.sliceTotals}}
export function buildW07D104RenewalCyclesMigration({readSource=(file)=>{try{return readFileSync(path.join(repo,file),'utf8')}catch{return null}}}={}){
 const ct=readRequired(p.contract,readSource),c=JSON.parse(ct)
 const bt=readRequired(p.base,readSource),b=JSON.parse(bt),source=readRequired(p.source,readSource)
 const order=readRequired(p.order,readSource),mandate=readRequired(p.mandate,readSource)
 const ledger=readRequired(p.ledger,readSource),boundary=readRequired(p.boundary,readSource),workflow=readRequired(p.workflow,readSource)
 const template=readRequired(p.template,readSource),l=JSON.parse(ledger),o=JSON.parse(boundary),w=JSON.parse(workflow)
 if(c.target?.domainId!=='D1-04'||c.target?.databaseName!=='luckread_finance'||c.target?.postgresMajor!==18||c.target?.cloudflareD1DatabaseUuid!=='9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'||c.target?.remoteSchemaApplied!==false||c.target?.productionCutoverAuthorized!==false||c.dependencies?.previousMigrationId!=='0002_w07_d1_04_saved_methods_mandates')throw new Error('W07 D1-04 renewal-cycle target, safety or dependency contract drift')
 if(c.primaryOwner?.worker!=='W07'||c.primaryOwner?.feature!=='PAY-004'||b.primaryOwner?.worker!=='W07'||b.target?.databaseName!=='luckread_finance'||b.schema?.totals?.tables!==10||b.schema?.totals?.explicitIndexes!==22||b.schema?.totals?.triggers!==49||b.schema?.totals?.triggerFunctions!==3||b.schema?.totals?.foreignKeys!==0||c.dependencies?.previousSchemaTotals?.tables!==8||c.dependencies?.previousSchemaTotals?.explicitIndexes!==18||c.dependencies?.previousSchemaTotals?.triggers!==36||c.dependencies?.previousSchemaTotals?.triggerFunctions!==2||c.dependencies?.previousSchemaTotals?.foreignKeys!==0||!b.scope?.includedSourceMigrations?.includes(c.scope?.includedSourceMigration)||!b.schema?.tables?.subscription_renewal_cycles||!b.schema?.tables?.subscription_renewal_scheduler_state||!b.schema?.cumulativeSlices?.some((item)=>item.migrationId==='0003_w07_d1_04_renewal_cycles'&&item.status==='LOCAL_POSTGRES18_REHEARSAL_PASSED')||b.schema?.sliceTotals?.renewalCycles?.tables!==2||b.schema?.sliceTotals?.renewalCycles?.explicitIndexes!==4||b.schema?.sliceTotals?.renewalCycles?.triggers!==13||b.schema?.sliceTotals?.renewalCycles?.triggerFunctions!==1||!l.domainOwners?.['D1-04']?.includes('W07')||o.physicalD1Registry?.['D1-04']!=='9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'||!o.workers?.W07?.allowedDomains?.includes('D1-04')||w.consumer?.businessAuthority!=='Membership, subscription, order, payment, MIT mandate and renewal-cycle state'||!w.authority?.W10?.includes('does not read/write D1-01 or D1-04')||!w.authority?.W07?.includes('Owns D1-04 renewal cycles'))throw new Error('W07 D1-04 renewal-cycle ownership or predecessor schema is not admitted')
 same(inventory(source,/CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z0-9_]+)/gi),tables,'PAY-004 table')
 same(inventory(source,/CREATE (?:UNIQUE )?INDEX\s+([A-Za-z0-9_]+)/gi),indexes,'PAY-004 index')
 same(inventory(source,/CREATE TRIGGER\s+([A-Za-z0-9_]+)/gi),triggers,'PAY-004 trigger')
 if(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:revenuecat_webhook_events|revenuecat_webhook_event_conflicts|refunds|billing_documents|payment_method_revocation_requests|entitlements|ledger_entries|payment_intents|users|media)\b/i.test(source))throw new Error('PAY-004 renewal-cycle slice contains a deferred or cross-domain table')
 if(!source.includes("NEW.state <> 'AWAITING_PRICING'")||!source.includes("NEW.state IN ('PAYMENT_READY','SUBMITTING')")||!source.includes("m.status = 'ACTIVE'")||!source.includes('NEW.version <> OLD.version + 1')||!source.includes("subscription_sync_state = 'APPLIED'"))throw new Error('PAY-004 initial-state, active-mandate, CAS or outcome-sync source guards are missing')
 if(c.scope?.includedTables?.join(',')!==tables.join(',')||c.schema?.totals?.tables!==2||c.schema?.totals?.explicitIndexes!==4||c.schema?.totals?.triggers!==13||c.schema?.totals?.triggerFunctions!==1||c.schema?.totals?.foreignKeys!==0||c.schema?.cumulativeAfterThisSlice?.tables!==10||c.schema?.cumulativeAfterThisSlice?.explicitIndexes!==22||c.schema?.cumulativeAfterThisSlice?.triggers!==49||c.schema?.cumulativeAfterThisSlice?.triggerFunctions!==3||c.schema?.cumulativeAfterThisSlice?.foreignKeys!==0)throw new Error('PAY-004 schema contract totals or scope drift')
 const hashes={W07_RENEWAL_CYCLES_SOURCE_SHA256:hash(source),BASE_ORDER_PAYMENT_SCHEMA_SHA256:hash(order),BASE_SAVED_METHODS_MANDATES_SCHEMA_SHA256:hash(mandate),RENEWAL_CYCLES_SCHEMA_CONTRACT_SEMANTIC_SHA256:hash(JSON.stringify(schemaProjection(c))),BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256:hash(JSON.stringify(baseProjection(b))),D1_04_OWNER_LEDGER_CONTRACT_SHA256:hash(ledger),D1_04_OWNER_BOUNDARY_CONTRACT_SHA256:hash(boundary),W10_RENEWAL_WORKFLOW_CONTRACT_SHA256:hash(workflow)}
 let sql=template;for(const [key,value] of Object.entries(hashes))sql=sql.replaceAll('{{'+key+'}}',value)
 if(/\{\{[A-Z0-9_]+\}\}/.test(sql))throw new Error('Unresolved W07 D1-04 renewal-cycle checksum placeholder')
 return {migration:sql,hashes,contract:c}
}
function run(){const result=buildW07D104RenewalCyclesMigration(),output=path.join(repo,p.output),actual=(()=>{try{return readFileSync(output,'utf8')}catch{return null}})();if(process.argv.includes('--write')){writeFileSync(output,result.migration);console.log('NEON_D1_04_W07_RENEWAL_CYCLES_MIGRATION_WRITTEN '+JSON.stringify({output:p.output,hashes:result.hashes,bytes:Buffer.byteLength(result.migration)}));return}if(actual!==result.migration)throw new Error('Committed W07 D1-04 renewal-cycle migration drift; regenerate with --write and review');console.log('NEON_D1_04_W07_RENEWAL_CYCLES_MIGRATION_CURRENT '+JSON.stringify({output:p.output,hashes:result.hashes,bytes:Buffer.byteLength(result.migration),totals:result.contract.schema.totals,remoteConnectionAttempted:false,remoteDdlExecuted:false}))}
if(process.argv[1]&&path.resolve(process.argv[1])===scriptPath){try{run()}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}}
