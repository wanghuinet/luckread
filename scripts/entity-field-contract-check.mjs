#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const catalog=JSON.parse(fs.readFileSync(path.join(root,'contracts/entity/entity-catalog.v1.json'),'utf8'));
const contract=JSON.parse(fs.readFileSync(path.join(root,'contracts/entity/entity-field-contract.v1.json'),'utf8'));
const failures=[]; const known=new Set(catalog.records.map(r=>r.entityId)); const seen=new Set();
if(contract.version!=='1.0') failures.push('version mismatch');
for(const r of contract.records){
 if(!known.has(r.entityId)) failures.push(`unknown entity: ${r.entityId}`);
 if(seen.has(r.entityId)) failures.push(`duplicate entity: ${r.entityId}`); seen.add(r.entityId);
 if(r.status==='VERIFIED' && (!r.fields.length || !r.evidenceRefs.length)) failures.push(`verified entity lacks fields/evidence: ${r.entityId}`);
 for(const f of r.fields){
  for(const k of ['fieldId','name','type','nullable','lifecycle','classification','status']) if(f[k]===undefined) failures.push(`${r.entityId}.${f.name||f.fieldId||'unknown'} missing ${k}`);
  if(f.status==='VERIFIED' && !r.evidenceRefs.length) failures.push(`verified field lacks entity evidence: ${r.entityId}.${f.name}`);
 }
}
for(const r of catalog.records) if(!seen.has(r.entityId)) failures.push(`missing field contract: ${r.entityId}`);
console.log(JSON.stringify({gate:'ENTITY-FIELD-CONTRACT',entityCount:catalog.records.length,contractCount:contract.records.length,status:failures.length?'BLOCKED':'READY',failures},null,2));
if(failures.length) process.exitCode=1;
