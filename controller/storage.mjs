import {randomUUID} from 'node:crypto';
const bad=message=>Object.assign(new Error(message),{status:422});
export function validateDatastore(input,runners=[]){
 if(!input||Object.keys(input).some(k=>!['name','server','exportPath','builderIds','platformBackups'].includes(k)))throw bad('Invalid storage fields');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw bad('Enter a storage name');
 if(typeof input.server!=='string'||! /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(input.server))throw bad('Enter an NFS hostname or IPv4 address');
 if(typeof input.exportPath!=='string'||!/^\/[A-Za-z0-9_./-]*$/.test(input.exportPath)||input.exportPath.length>512||input.exportPath.split('/').some(x=>x==='.'||x==='..'))throw bad('Enter an absolute NFS export path without traversal');
 if(typeof input.platformBackups!=='boolean')throw bad('Select platform backup usage');
 if(!Array.isArray(input.builderIds)||input.builderIds.length>100||new Set(input.builderIds).size!==input.builderIds.length)throw bad('Select unique builders');
 for(const id of input.builderIds){
  const host=runners.find(r=>r.id===id);
  if(!host||host.os!=='linux'||!host.managedHost||host.decommission)throw bad('NFS mounting requires an enrolled managed Linux builder');
 }
 if(!input.platformBackups&&!input.builderIds.length)throw bad('Assign storage to the platform or a builder');
 return {id:randomUUID(),name:input.name.trim(),server:input.server,exportPath:input.exportPath.replace(/\/+$/,'')||'/',builderIds:[...input.builderIds],platformBackups:input.platformBackups,createdAt:new Date().toISOString()};
}
export function queueStorageMount(s,store,runnerId){
 if(!store.builderIds.includes(runnerId))throw bad('Builder is not assigned to this datastore');
 const runner=s.runners.find(r=>r.id===runnerId);
 if(!runner||runner.decommission)throw bad('Builder is unavailable');
 s.hostActions ||= [];
 if(s.hostActions.some(a=>a.runnerId===runnerId&&a.storage?.id===store.id&&['queued','claimed'].includes(a.status)&&Date.parse(a.expiresAt)>Date.now()))throw bad('A mount request is already pending');
 const action={id:randomUUID(),type:'storage.nfs.mount',runnerId,status:'queued',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60*1000).toISOString(),storage:{id:store.id,server:store.server,export_path:store.exportPath}};
 s.hostActions.push(action);return action;
}
export function storageSnapshot(s){
 return {datastores:(s.datastores||[]).map(d=>({...d,platformStatus:d.platformBackups?'host-mount-required':'not-assigned',hosts:d.builderIds.map(id=>{
 const actions=(s.hostActions||[]).filter(a=>a.runnerId===id&&a.storage?.id===d.id),last=actions.at(-1);
 return {id,name:s.runners.find(r=>r.id===id)?.name||id,status:last?.status||'not-mounted',message:last?.message||null,checkedAt:last?.completedAt||null};
 })})),builders:s.runners.filter(r=>r.managedHost&&r.os==='linux'&&!r.decommission).map(r=>({id:r.id,name:r.name}))};
}
export async function storageRoute(req,ctx){
 const path=new URL(req.url).pathname;
 if(!path.startsWith('/api/local/storage'))return null;
 const {state,save,reply,deny,body}=ctx;
 try{
 if(path==='/api/local/storage'&&req.method==='GET')return reply(storageSnapshot(state()));
 if(path==='/api/local/storage'&&req.method==='POST'){
  const input=await body(req),s=state(),store=validateDatastore(input,s.runners);
  s.datastores ||= [];
  if(s.datastores.length>=100)throw bad('Storage limit reached');
  if(s.datastores.some(d=>d.server===store.server&&d.exportPath===store.exportPath))throw bad('This NFS export is already configured');
  s.datastores.push(store);
  for(const id of store.builderIds)queueStorageMount(s,store,id);
  save(s);return reply({datastore:store},201);
 }
 if(path==='/api/local/storage/retry'&&req.method==='POST'){
  const input=await body(req),s=state(),store=s.datastores?.find(d=>d.id===input.datastoreId);
  if(!store)throw bad('Unknown datastore');
  const action=queueStorageMount(s,store,input.builderId);save(s);return reply({actionId:action.id});
 }
 return deny(404,'Unknown storage endpoint');
 }catch(e){return deny(e.status||500,e.status?e.message:'Storage operation failed');}
}
