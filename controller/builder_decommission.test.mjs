import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminHostRoute,agentHostRoute} from './host_routes.mjs';

const ID='abcdef123456abcdef123456';
function harness({online=false,registered=false,actions=[]}={}){
 let data={
  admin:{password:{algorithm:'mock'}},
  github:{selectedOrganization:'MainCreate',oauthUser:{login:'tester'},oauthToken:{ct:'fake'}},
  runners:[{id:ID,name:'builder-linux-arm64-01',os:'linux',arch:'arm64',
   tokenHash:'host-token',lastSeen:online?new Date().toISOString():null,
   githubRunnerName:registered?'builder-linux-arm64-01':null}],
  hostActions:actions
 };
 const state=()=>structuredClone(data);
 const save=s=>{data=structuredClone(s);};
 const ctx={state,save,body:async req=>await req.json(),reply:(data,status=200)=>Response.json(data,{status}),
  deny:(code,error)=>Response.json({error},{status:code}),rnd:()=>crypto.randomUUID().replaceAll('-',''),
  digest:x=>x,equal:(a,b)=>a===b,session:()=>({username:'administrator'}),
  seal:x=>x,unseal:()=> 'fake-token',
  githubIdentityCurrent:()=>true,limited:()=>false,
  verifyPassword:async p=>p==='correct-password'};
 const call=async(path,payload,agent=false)=>{
  const req=new Request('http://localhost'+path,{method:'POST',
   headers:{'content-type':'application/json',...agent?{authorization:'Bearer host-token'}:{}},
   body:JSON.stringify(payload)});
  const fn=agent?agentHostRoute:adminHostRoute;
  const res=await fn(req,ctx);
  return {status:res.status,data:await res.json()};
 };
 const removal=(extras={})=>call('/api/local/builders/remove',{
  runnerId:ID,confirmName:'builder-linux-arm64-01',password:'correct-password',
  mode:online?'managed':'remote',...extras
 });
 return {call,removal,state,setState:s=>{data=structuredClone(s)}};
}

test('Wrong password and mismatched hostname do not revoke enrollment',async()=>{
 const h=harness();
 assert.equal((await h.removal({password:'wrong'})).status,401);
 assert.equal((await h.removal({confirmName:'wrong'})).status,422);
 assert.equal(h.state().runners.length,1);
});
test('Unreachable host is removed, token revoked, and cleanup recorded',async()=>{
 const h=harness();
 const res=await h.removal();
 assert.equal(res.status,200);
 assert.equal(res.data.removed,true);
 assert.equal(res.data.localCleanupRequired,true);
 assert.equal(h.state().runners.length,0);
 assert.equal(h.state().builderRemovalAudit[0].localResult,'not_reachable');
});
test('Connected host is queued and remains until cleanup acknowledgment',async()=>{
 const h=harness({online:true});
 const initial=await h.removal();
 assert.equal(initial.status,200);
 assert.equal(initial.data.phase,'cleaning');
 assert.equal(h.state().runners.length,1);
 assert.equal(h.state().hostActions[0].type,'host.cleanup');
 const c=await h.call('/api/agent/actions/claim',{id:ID},true);
 assert.equal(c.status,200);
 assert.equal(c.data.action.type,'host.cleanup');
 const done=await h.call('/api/agent/actions/complete',{
  id:ID,action_id:c.data.action.id,success:true,message:'cleanup scheduled'
 },true);
 assert.equal(done.status,200);
 assert.equal(h.state().runners.length,0);
 assert.equal(h.state().builderRemovalAudit[0].localResult,'cleanup_scheduled');
});
test('Queued registration blocks removal',async()=>{
 const h=harness({actions:[{id:'pending',runnerId:ID,status:'queued'}]});
 assert.equal((await h.removal()).status,409);
 assert.equal(h.state().runners.length,1);
});
test('Unreachable registered runner: busy GitHub job blocks force removal',async()=>{
 const h=harness({registered:true,actions:[{id:'old',runnerId:ID,organization:'MainCreate',
  runnerName:'builder-linux-arm64-01',status:'completed'}]});
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{
  if(String(url).includes('/actions/runners?'))return Response.json({
   total_count:1,runners:[{name:'builder-linux-arm64-01',id:100,status:'online',busy:true}]
  });
  throw Error('Unexpected GitHub operation '+url);
 };
 try{
  assert.equal((await h.removal()).status,502);
  assert.equal(h.state().runners.length,1);
  assert.equal(h.state().runners[0].decommission.phase,'failed');
 }finally{globalThis.fetch=original}
});
test('Unreachable, idle but online GitHub runner can be de-registered',async()=>{
 const h=harness({registered:true,actions:[{id:'old',runnerId:ID,organization:'MainCreate',
  runnerName:'builder-linux-arm64-01',status:'completed'}]});
 const original=globalThis.fetch;let deletes=0;
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).includes('/actions/runners?'))return Response.json({
   total_count:1,runners:[{name:'builder-linux-arm64-01',id:100,status:'online',busy:false}]
  });
  if(String(url).endsWith('/actions/runners/100')&&opts.method==='DELETE'){
   deletes++;return new Response(null,{status:204});
  }
  throw Error('Unexpected GitHub operation '+url);
 };
 try{
  const removed=await h.removal();
  assert.equal(removed.status,200);
  assert.equal(removed.data.githubResult,'removed');
  assert.equal(deletes,1);
  assert.equal(h.state().runners.length,0);
 }finally{globalThis.fetch=original}
});

test('Force removal accepts failed initial setup while host still heartbeats',async()=>{
 const h=harness({online:true,actions:[{id:'failed',runnerId:ID,status:'failed',
  runnerName:'builder-linux-arm64-01'}]});
 const updated=h.state();updated.runners[0].managedHost={host:'builder-linux-arm64-01.local'};
 h.setState(updated);
 const result=await h.removal({mode:'remote'});
 assert.equal(result.status,200);
 assert.equal(result.data.removed,true);
 assert.equal(h.state().runners.length,0);
});
test('Validation reports missing registration and heartbeat without claiming readiness',async()=>{
 const h=harness({online:true});
 const result=await h.call('/api/local/builders/validate',{runnerId:ID});
 assert.equal(result.status,200);
 assert.equal(result.data.ready,false);
 assert(result.data.checks.some(c=>c.label==='GitHub registration'&&c.status==='fail'));
 assert(result.data.checks.some(c=>c.label==='Host heartbeat'&&c.status==='pass'));
});
