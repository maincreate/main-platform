import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backupGate} from './backup_policy.mjs';
const ctx={deviceId:'device-a',jobId:'job-a'};
test('backup is required by default and failure never changes policy',()=>{
 for(const status of ['failed','pending','writing',undefined])assert.equal(backupGate({...ctx,backup:{status}}).allowed,false);
 assert.equal(backupGate({...ctx,mode:'skip'}).allowed,false);
 assert.equal(backupGate({...ctx,mode:'skip',skipAcknowledged:true}).allowed,true);
});
test('backup cannot be reused across devices or flash jobs',()=>{
 const backup={...ctx,status:'verified',sha256:'a'.repeat(64),size:4096};
 assert.equal(backupGate({...ctx,backup}).allowed,true);
 for(const change of [{deviceId:'other'},{jobId:'old-job'},{sha256:'bad'},{size:0}])assert.equal(backupGate({...ctx,backup:{...backup,...change}}).allowed,false);
});
