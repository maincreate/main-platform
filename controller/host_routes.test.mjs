import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHostRoute} from './host_routes.mjs';
function harness(){
 const s={runners:[{id:'host-1',tokenHash:'expected',name:'pi'}],hostActions:[{id:'action-1',runnerId:'host-1',runnerName:'tt-pi',organization:'MainCreate',labels:['tt-arm64'],secret:{opaque:true},expiresAt:new Date(Date.now()+600000).toISOString(),status:'queued'}]};
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
 assert.equal(s.runners[0].githubRunnerName,'tt-pi');
 assert.equal('secret' in s.hostActions[0],false);
});
test('failed registration is not shown ready',async()=>{
 const {s,ctx}=harness();s.hostActions[0].status='claimed';
 await agentHostRoute(new Request('http://localhost/api/agent/actions/complete',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer expected'},body:JSON.stringify({id:'host-1',action_id:'action-1',success:false,message:'GitHub rejected'})}),ctx);
 assert.equal(s.hostActions[0].status,'failed');assert.equal(s.runners[0].githubRunnerName,undefined);
});
