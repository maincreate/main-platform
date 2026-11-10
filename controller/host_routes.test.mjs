import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHostRoute} from './host_routes.mjs';
function harness(){
 const s={runners:[{id:'host-1',tokenHash:'expected',name:'pi'}],hostActions:[{id:'action-1',runnerId:'host-1',runnerName:'maincreate-pi',organization:'MainCreate',labels:['maincreate-arm64'],secret:{opaque:true},expiresAt:new Date(Date.now()+600000).toISOString(),status:'queued'}]};
 const ctx={state:()=>s,save:()=>{},body:async req=>await req.json(),reply:obj=>new Response(JSON.stringify(obj)),deny:(status,msg)=>new Response(JSON.stringify({error:msg}),{status}),digest:x=>x,equal:(x,y)=>x===y,unseal:()=> 'short-lived-secret'};
 return {s,ctx};
}
test('only enrolled host may claim a controller-issued action',async()=>{
 const {s,ctx}=harness();
 const denied=await agentHostRoute(new Request('http://localhost/api/agent/actions/claim',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer bad'},body:JSON.stringify({id:'host-1'})}),ctx);
 assert.equal(denied.status,401);assert.equal(s.hostActions[0].status,'queued');
 const granted=await agentHostRoute(new Request('http://localhost/api/agent/actions/claim',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer expected'},body:JSON.stringify({id:'host-1'})}),ctx);
 assert.equal(granted.status,200);
 const result=await granted.json();
 assert.equal(result.action.type,'github-runner.provision');
 assert.equal(result.action.registration_token,'short-lived-secret');
 assert.equal(s.hostActions[0].status,'claimed');
});
test('success marks managed runner and discards token',async()=>{
 const {s,ctx}=harness();s.hostActions[0].status='claimed';
 const r=await agentHostRoute(new Request('http://localhost/api/agent/actions/complete',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer expected'},body:JSON.stringify({id:'host-1',action_id:'action-1',success:true,message:'ok'})}),ctx);
 assert.equal(r.status,200);assert.equal(s.hostActions[0].status,'completed');
 assert.equal(s.runners[0].githubRunnerName,'maincreate-pi');
 assert.equal('secret' in s.hostActions[0],false);
});
test('failed registration is not shown ready',async()=>{
 const {s,ctx}=harness();s.hostActions[0].status='claimed';
 await agentHostRoute(new Request('http://localhost/api/agent/actions/complete',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer expected'},body:JSON.stringify({id:'host-1',action_id:'action-1',success:false,message:'GitHub rejected'})}),ctx);
 assert.equal(s.hostActions[0].status,'failed');assert.equal(s.runners[0].githubRunnerName,undefined);
});

test('authenticated group member receives NFS assignment without GitHub secrets',async()=>{
 const {s,ctx}=harness();s.hostActions=[];
 Object.assign(s.runners[0],{os:'linux',managedHost:true,hostVersion:'0.8.0'});
 s.builderGroups=[{id:'group',name:'Lab',builderIds:['host-1']}];
 s.datastores=[{id:'store',server:'nas.example',exportPath:'/backups',builderIds:[],groupIds:['group']}];
 const request=token=>new Request('http://localhost/api/agent/actions/claim',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({id:'host-1'})});
 assert.equal((await agentHostRoute(request('bad'),ctx)).status,401);assert.equal(s.hostActions.length,0);
 const result=await (await agentHostRoute(request('expected'),ctx)).json();
 assert.equal(result.action.type,'storage.nfs.mount');assert.equal(result.action.storage.export_path,'/backups');
 assert.equal(result.action.registration_token,null);
 await agentHostRoute(request('expected'),ctx);assert.equal(s.hostActions.length,1);
});
test('storage completion cannot advance a concurrent builder removal',async()=>{
 const {s,ctx}=harness();s.hostActions[0].type='storage.nfs.mount';s.hostActions[0].status='claimed';
 s.runners[0].decommission={phase:'stopping'};
 await agentHostRoute(new Request('http://localhost/api/agent/actions/complete',{method:'POST',headers:{authorization:'Bearer expected'},body:JSON.stringify({id:'host-1',action_id:'action-1',success:true,message:'mounted'})}),ctx);
 assert.equal(s.runners[0].decommission.phase,'stopping');
 assert.equal(s.runners[0].githubRunnerName,undefined);
});
