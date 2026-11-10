import {randomUUID} from 'node:crypto';
const bad=message=>Object.assign(new Error(message),{status:422});
const eligible=host=>host?.os==='linux'&&host.managedHost&&!host.decommission;
const uniqueIds=(ids,label)=>{
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw bad('Select unique '+label);
 return ids;
};
export function effectiveBuilders(s,store){
 const inherited=(store.groupIds||[]).flatMap(id=>s.builderGroups?.find(g=>g.id===id)?.builderIds||[]);
 return [...new Set([...store.builderIds,...inherited])].filter(id=>eligible(s.runners.find(r=>r.id===id)));
}
export function validateGroup(input,runners){
 if(!input||Object.keys(input).some(k=>!['name','builderIds'].includes(k)))throw bad('Invalid builder group fields');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw bad('Enter a group name');
 const ids=uniqueIds(input.builderIds,'builders');
 if(ids.some(id=>!eligible(runners.find(r=>r.id===id))))throw bad('Groups require managed Linux builders');
 return {id:randomUUID(),name:input.name.trim(),builderIds:[...ids]};
}
export function validateDatastore(input,runners=[],groups=[]){
 if(!input||Object.keys(input).some(k=>!['name','server','exportPath','builderIds','groupIds','platformBackups','deviceBackups'].includes(k)))throw bad('Invalid storage fields');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw bad('Enter a storage name');
 if(typeof input.server!=='string'||! /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(input.server))throw bad('Enter an NFS hostname or IPv4 address');
 if(typeof input.exportPath!=='string'||!/^\/[A-Za-z0-9_./-]*$/.test(input.exportPath)||input.exportPath.length>512||input.exportPath.split('/').some(x=>x==='.'||x==='..'))throw bad('Enter an absolute NFS export path without traversal');
 if(typeof input.platformBackups!=='boolean')throw bad('Select platform backup usage');
 const deviceBackups=input.deviceBackups===undefined?!!(input.builderIds?.length||input.groupIds?.length):input.deviceBackups;
 if(typeof deviceBackups!=='boolean')throw bad('Select device backup usage');
 if(!deviceBackups&&(input.builderIds?.length||input.groupIds?.length))throw bad('Enable device backups before selecting builders');
 if(!Array.isArray(input.builderIds)||input.builderIds.length>100||new Set(input.builderIds).size!==input.builderIds.length)throw bad('Select unique builders');
 for(const id of input.builderIds){
  const host=runners.find(r=>r.id===id);
  if(!host||host.os!=='linux'||!host.managedHost||host.decommission)throw bad('NFS mounting requires an enrolled managed Linux builder');
 }
 const groupIds=uniqueIds(input.groupIds||[],'groups');
 if(groupIds.some(id=>!groups.some(g=>g.id===id)))throw bad('Unknown builder group');
 if(deviceBackups&&!input.builderIds.length&&!groupIds.length)throw bad('Select at least one builder or group for device backups');
 if(!input.platformBackups&&!deviceBackups)throw bad('Assign storage to the platform or a builder');
 return {id:randomUUID(),name:input.name.trim(),server:input.server,exportPath:input.exportPath.replace(/\/+$/,'')||'/',builderIds:[...input.builderIds],groupIds:[...groupIds],platformBackups:input.platformBackups,deviceBackups,createdAt:new Date().toISOString()};
}
export function queueStorageMount(s,store,runnerId){
 if(!effectiveBuilders(s,store).includes(runnerId))throw bad('Builder is not assigned to this datastore');
 const runner=s.runners.find(r=>r.id===runnerId);
 if(!runner||runner.decommission)throw bad('Builder is unavailable');
 s.hostActions ||= [];
 if(s.hostActions.some(a=>a.runnerId===runnerId&&a.storage?.id===store.id&&['queued','claimed'].includes(a.status)&&Date.parse(a.expiresAt)>Date.now()))throw bad('A mount request is already pending');
 const action={id:randomUUID(),type:'storage.nfs.mount',runnerId,status:'queued',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+10*60*1000).toISOString(),storage:{id:store.id,server:store.server,export_path:store.exportPath}};
 s.hostActions.push(action);return action;
}
// Revalidate on an authenticated host poll, recovering missing mounts after reboot.
// A completion is a point-in-time check, never permanent mount health.
export function reconcileStorage(s,runnerId,now=Date.now()){
 const host=s.runners.find(r=>r.id===runnerId);
 if(!eligible(host))return;
 const version=(host.hostVersion||'').split('.').map(Number);
 if(version.length!==3||version.some(v=>!Number.isInteger(v))||version[0]===0&&version[1]<8)return;
 for(const store of s.datastores||[]){
  if(!effectiveBuilders(s,store).includes(runnerId))continue;
  const last=(s.hostActions||[]).filter(a=>a.runnerId===runnerId&&a.storage?.id===store.id).at(-1);
  if(last&&['queued','claimed'].includes(last.status)&&Date.parse(last.expiresAt)>now)continue;
  const observed=Date.parse(last?.completedAt||last?.createdAt||'');
  if(Number.isFinite(observed)&&now-observed<5*60*1000)continue;
  queueStorageMount(s,store,runnerId);
 }
}
export function storageSnapshot(s){
 return {datastores:(s.datastores||[]).map(d=>({...d,platformStatus:d.platformBackups?'host-mount-required':'not-assigned',hosts:effectiveBuilders(s,d).map(id=>{
 const actions=(s.hostActions||[]).filter(a=>a.runnerId===id&&a.storage?.id===d.id),last=actions.at(-1);
 return {id,name:s.runners.find(r=>r.id===id)?.name||id,status:last?.status==='completed'&&Date.now()-Date.parse(last.completedAt)>6*60*1000?'stale':last?.status||'not-mounted',message:last?.message||null,checkedAt:last?.completedAt||null};
 })})),groups:s.builderGroups||[],builders:s.runners.filter(r=>r.managedHost&&r.os==='linux'&&!r.decommission).map(r=>({id:r.id,name:r.name}))};
}
export async function storageRoute(req,ctx){
 const path=new URL(req.url).pathname;
 if(!path.startsWith('/api/local/storage'))return null;
 const {state,save,reply,deny,body}=ctx;
 try{
 if(path==='/api/local/storage'&&req.method==='GET')return reply(storageSnapshot(state()));
 if(path==='/api/local/storage'&&req.method==='POST'){
  const input=await body(req),s=state(),store=validateDatastore(input,s.runners,s.builderGroups||[]);
  s.datastores ||= [];
  if(s.datastores.length>=100)throw bad('Storage limit reached');
  if(s.datastores.some(d=>d.server===store.server&&d.exportPath===store.exportPath))throw bad('This NFS export is already configured');
  s.datastores.push(store);
  for(const id of effectiveBuilders(s,store))queueStorageMount(s,store,id);
  save(s);return reply({datastore:store},201);
 }
 if(path==='/api/local/storage/groups'&&req.method==='POST'){
  const input=await body(req),s=state(),group=validateGroup(input,s.runners);
  s.builderGroups ||= [];
  if(s.builderGroups.length>=100)throw bad('Group limit reached');
  if(s.builderGroups.some(g=>g.name.toLowerCase()===group.name.toLowerCase()))throw bad('Group name already exists');
  s.builderGroups.push(group);save(s);return reply({group},201);
 }
 if(path==='/api/local/storage/groups/members'&&req.method==='POST'){
  const input=await body(req),s=state();
  if(Object.keys(input).some(k=>!['groupId','builderIds'].includes(k)))throw bad('Invalid membership fields');
  const group=s.builderGroups?.find(g=>g.id===input.groupId);
  if(!group)throw bad('Unknown builder group');
  const ids=uniqueIds(input.builderIds,'builders');
  if(ids.some(id=>!eligible(s.runners.find(r=>r.id===id))))throw bad('Groups require managed Linux builders');
  const combined=[...new Set([...group.builderIds,...ids])];
  if(combined.length>100)throw bad('Group member limit reached');
  group.builderIds=combined;
  // Assignment is inherited immediately; authenticated polling performs mounting.
  save(s);return reply({group});
 }
 if(path==='/api/local/storage/retry'&&req.method==='POST'){
  const input=await body(req),s=state(),store=s.datastores?.find(d=>d.id===input.datastoreId);
  if(!store)throw bad('Unknown datastore');
  const action=queueStorageMount(s,store,input.builderId);save(s);return reply({actionId:action.id});
 }
 return deny(404,'Unknown storage endpoint');
 }catch(e){return deny(e.status||500,e.status?e.message:'Storage operation failed');}
}
