#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const file=path.join(root,'contracts/entity/entity-catalog.v1.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const failures=[]; const seen=new Set();
for(const r of data.records??[]){
 if(seen.has(r.entityId)) failures.push(`duplicate entityId: ${r.entityId}`);
 seen.add(r.entityId);
 if(r.status!=='VERIFIED') failures.push(`unverified entity: ${r.entityId}`);
 if(!r.evidenceRefs?.length) failures.push(`missing evidence: ${r.entityId}`);
}
if(!data.records?.length) failures.push('entity catalog is empty');
const report={gate:'ENTITY-CATALOG',recordCount:data.records?.length??0,status:failures.length?'BLOCKED':'READY',failures};
console.log(JSON.stringify(report,null,2));
if(failures.length) process.exitCode=1;
