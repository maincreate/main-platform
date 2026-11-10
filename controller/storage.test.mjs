import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDatastore,queueStorageMount,storageSnapshot,storageRoute} from './storage.mjs';
const runner={id:'host-a',name:'pi',os:'linux',managedHost:true};
const input={name:'Backups',server:'nas.example',exportPath:'/volume1/maincreate',builderIds:['host-a'],platformBackups:true};
test('NFS assignments reject unsafe paths, servers and ineligible hosts',()=>{
 for(const exportPath of ['relative','/a/../b','/a/./b','/a\nb','/x;id'])assert.throws(()=>validateDatastore({...input,exportPath},[runner]));
 for(const server of ['-o','nas;id','nas:/etc','nas\nother'])assert.throws(()=>validateDatastore({...input,server},[runner]));
 assert.throws(()=>validateDatastore({...input,builderIds:['host-a','host-a']},[runner]));
 assert.throws(()=>validateDatastore(input,[{...runner,os:'windows'}]));
 assert.throws(()=>validateDatastore({...input,mountOptions:'exec'},[runner]));
});
test('mount actions are bounded, assigned and tracked independently',()=>{
 const s={runners:[runner]},d=validateDatastore(input,s.runners);s.datastores=[d];
 const a=queueStorageMount(s,d,runner.id);
 assert.equal(a.type,'storage.nfs.mount');assert.equal(a.storage.export_path,input.exportPath);
 assert.throws(()=>queueStorageMount(s,d,'other'));
 assert.throws(()=>queueStorageMount(s,d,runner.id));
 assert.equal(storageSnapshot(s).datastores[0].hosts[0].status,'queued');
 a.status='failed';a.message='Export denied';
 assert.equal(storageSnapshot(s).datastores[0].hosts[0].message,'Export denied');
 queueStorageMount(s,d,runner.id);
});
test('storage API persists configuration and rejects duplicate exports',async()=>{
 let s={runners:[runner]},saves=0;
 const ctx={state:()=>s,save:v=>{s=v;saves++},body:r=>r.json(),reply:(data,status=200)=>({data,status}),deny:(status,error)=>({status,error})};
 const request=()=>new Request('http://localhost/api/local/storage',{method:'POST',body:JSON.stringify(input)});
 assert.equal((await storageRoute(request(),ctx)).status,201);
 assert.equal(saves,1);assert.equal(s.hostActions.length,1);
 assert.equal((await storageRoute(request(),ctx)).status,422);
 assert.equal(saves,1);
});

test('group assignment deduplicates explicit members and inherits new members',async()=>{
 const {effectiveBuilders,reconcileStorage}=await import('./storage.mjs');
 const s={runners:[{...runner,hostVersion:'0.8.0'},{...runner,id:'host-b',hostVersion:'0.8.0'}],builderGroups:[{id:'group-a',name:'Lab',builderIds:['host-a']}]};
 const d=validateDatastore({...input,groupIds:['group-a']},s.runners,s.builderGroups);s.datastores=[d];
 assert.deepEqual(effectiveBuilders(s,d),['host-a']);
 s.builderGroups[0].builderIds.push('host-b');
 assert.deepEqual(effectiveBuilders(s,d),['host-a','host-b']);
 reconcileStorage(s,'host-b');assert.equal(s.hostActions.length,1);
 reconcileStorage(s,'host-b');assert.equal(s.hostActions.length,1);
 s.hostActions[0].status='completed';s.hostActions[0].completedAt=new Date(Date.now()-7*60*1000).toISOString();
 assert.equal(storageSnapshot(s).datastores[0].hosts[1].status,'stale');
 reconcileStorage(s,'host-b');assert.equal(s.hostActions.length,2);
});
test('storage reconciliation excludes old agents and decommissioned builders',async()=>{
 const {reconcileStorage}=await import('./storage.mjs');
 const s={runners:[{...runner,hostVersion:'0.7.0'}],datastores:[validateDatastore(input,[runner])]};
 reconcileStorage(s,'host-a');assert.equal(s.hostActions,undefined);
 s.runners[0].hostVersion='0.8.0';s.runners[0].decommission={phase:'stopping'};
 reconcileStorage(s,'host-a');assert.equal(s.hostActions,undefined);
});
test('group API creates groups and adds only eligible members',async()=>{
 let s={runners:[runner]},saves=0;
 const ctx={state:()=>s,save:v=>{s=v;saves++},body:r=>r.json(),reply:(data,status=200)=>({data,status}),deny:(status,error)=>({status,error})};
 const request=(path,data)=>new Request('http://localhost/api/local/storage/'+path,{method:'POST',body:JSON.stringify(data)});
 const created=await storageRoute(request('groups',{name:'Lab',builderIds:[]}),ctx);
 assert.equal(created.status,201);const groupId=created.data.group.id;
 assert.equal((await storageRoute(request('groups/members',{groupId,builderIds:['host-a']}),ctx)).status,200);
 assert.deepEqual(s.builderGroups[0].builderIds,['host-a']);
 assert.equal((await storageRoute(request('groups/members',{groupId,builderIds:['unknown']}),ctx)).status,422);
 assert.equal(saves,2);
});
