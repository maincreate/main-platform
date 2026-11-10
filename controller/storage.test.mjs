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
