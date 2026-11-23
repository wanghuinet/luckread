#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const domains = ['D1-01','D1-02','D1-03','D1-04','D1-05'];
const safeRel = (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\\\') && !/^[A-Za-z]:/.test(p) && p.split('/').every(part => part && part !== '.' && part !== '..');
function walk(root, dir=root, out=[]) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) throw new Error('hidden files/directories are not admitted: '+relative(root,resolve(dir,name)));
    const path=resolve(dir,name), s=lstatSync(path), rel=relative(root,path).split(sep).join('/');
    if(s.isSymbolicLink()) throw new Error('symlinks are not admitted: '+rel);
    if(s.isDirectory()) walk(root,path,out);
    else if(s.isFile() && name !== 'snapshot-manifest.json') out.push(rel);
    else throw new Error('unsupported snapshot entry: '+rel);
  }
  return out;
}
function bundleDigest(files) {
  return sha(Buffer.from(files.map(f=>f.path+'\t'+f.sizeBytes+'\t'+f.sha256+'\n').join(''),'utf8'));
}
export function buildSnapshotManifest(root, domainId, sourceSnapshotId) {
  if(!domains.includes(domainId)) throw new Error('invalid domainId');
  if(typeof sourceSnapshotId!=='string'||!sourceSnapshotId.trim()||sourceSnapshotId.length>160) throw new Error('sourceSnapshotId required');
  const base=resolve(root);
  const files=walk(base).map(path=>{const bytes=readFileSync(resolve(base,path));return {path,sizeBytes:bytes.length,sha256:sha(bytes)};});
  if(!files.length) throw new Error('snapshot is empty');
  return {version:'1.0.0',type:'READ_ONLY_D1_EXPORT_SNAPSHOT_MANIFEST',domainId,sourceSnapshotId,createdAt:null,files,bundleSha256:bundleDigest(files),verification:{verified:false,verifiedAt:null},safety:{sourceDatabaseModified:false,targetDatabaseModified:false,importExecuted:false,cutoverAuthorized:false}};
}
export function verifySnapshot(root, manifest) {
  const errors=[];
  if(manifest?.type!=='READ_ONLY_D1_EXPORT_SNAPSHOT_MANIFEST') errors.push('invalid manifest type');
  if(!domains.includes(manifest?.domainId)) errors.push('invalid domain');
  if(!Array.isArray(manifest?.files)||!manifest.files.length) errors.push('file inventory missing');
  if(manifest?.safety?.sourceDatabaseModified!==false||manifest?.safety?.targetDatabaseModified!==false||manifest?.safety?.importExecuted!==false||manifest?.safety?.cutoverAuthorized!==false) errors.push('safety flags must remain false in snapshot verification');
  const base=resolve(root), listed=new Set();
  for(const f of manifest?.files??[]){
    if(!f || !safeRel(f.path) || listed.has(f.path) || !Number.isSafeInteger(f.sizeBytes) || f.sizeBytes<0 || !/^[a-f0-9]{64}$/.test(f.sha256)){errors.push('unsafe, malformed, or duplicate inventory entry');continue;}
    listed.add(f.path);
    try{const bytes=readFileSync(resolve(base,f.path));if(bytes.length!==f.sizeBytes||sha(bytes)!==f.sha256) errors.push('checksum or size mismatch: '+f.path);}catch{errors.push('missing/unreadable file: '+f.path);}
  }
  try{const actual=walk(base);for(const path of actual)if(!listed.has(path))errors.push('unlisted snapshot file: '+path);for(const path of listed)if(!actual.includes(path))errors.push('manifest entry absent from snapshot: '+path);}catch(e){errors.push(e.message);}
  const bundle=bundleDigest(manifest?.files??[]);
  if(bundle!==manifest?.bundleSha256)errors.push('bundle checksum mismatch');
  return {valid:errors.length===0,errors,domainId:manifest?.domainId,fileCount:manifest?.files?.length??0,bundleSha256:bundle,importExecuted:false,cutoverAuthorized:false};
}
function main(){
 const [mode,arg,domain,id]=process.argv.slice(2);
 if(mode==='generate'){
   if(!arg||!domain||!id)throw new Error('usage: generate <snapshot-directory> <D1-xx> <snapshot-id>');
   const m=buildSnapshotManifest(arg,domain,id);writeFileSync(resolve(arg,'snapshot-manifest.json'),JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({fileCount:m.files.length,bundleSha256:m.bundleSha256,manifest:'snapshot-manifest.json',safety:m.safety},null,2));
 }else if(mode==='verify'){
   if(!arg)throw new Error('usage: verify <manifest-path>');
   const manifestPath=resolve(arg), m=JSON.parse(readFileSync(manifestPath,'utf8'));const r=verifySnapshot(resolve(manifestPath,'..'),m);console.log(JSON.stringify(r,null,2));if(!r.valid)process.exitCode=1;
 }else throw new Error('mode must be generate or verify');
}
if(process.argv[1] && import.meta.url === new URL('file://'+resolve(process.argv[1])).href) main();
