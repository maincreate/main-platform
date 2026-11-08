import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminHostRoute,agentHostRoute,removalActivity,removalTimeline} from './host_routes.mjs';

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
test('Unsupported legacy Host Service leaves a recoverable builder and allows forced cleanup',async()=>{
 const h=harness({online:true});
 const initial=await h.removal();
 assert.equal(initial.status,200);
 const claim=await h.call('/api/agent/actions/claim',{id:ID},true);
 const result=await h.call('/api/agent/actions/complete',{
  id:ID,action_id:claim.data.action.id,success:false,message:'unsupported action'
 },true);
 assert.equal(result.status,200);
 assert.equal(h.state().runners.length,1);
 assert.equal(h.state().runners[0].decommission.phase,'failed');
 assert.match(h.state().runners[0].decommission.error,/Upgrade/i);
 const force=await h.removal({mode:'remote'});
 assert.equal(force.status,200);
 assert.equal(force.data.localCleanupRequired,true);
 assert.equal(h.state().runners.length,0);
});
test('Queued registration blocks removal',async()=>{
 const h=harness({actions:[{id:'pending',runnerId:ID,status:'queued',expiresAt:new Date(Date.now()+60000).toISOString()}]});
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

test('Stored removal without an active action is stalled, not in progress',()=>{
 const host={id:ID,decommission:{phase:'stopping'}};
 assert.equal(removalActivity(host,[]).stalled,true);
 assert.equal(removalActivity(host,[{runnerId:ID,type:'github-runner.stop',status:'queued',
  expiresAt:new Date(Date.now()-60000).toISOString()}]).stalled,true);
 assert.equal(removalActivity(host,[{runnerId:ID,type:'github-runner.stop',status:'queued',
  expiresAt:new Date(Date.now()+60000).toISOString()}]).active,true);
});
test('Stalled removal can be reconciled without unregistering or deleting the builder',async()=>{
 const h=harness({online:true,registered:true,actions:[{id:'expired',runnerId:ID,type:'github-runner.stop',
  status:'claimed',expiresAt:new Date(Date.now()-60000).toISOString()}]});
 const data=h.state();data.runners[0].decommission={phase:'stopping',mode:'managed'};h.setState(data);
 const result=await h.call('/api/local/builders/removal/reconcile',{runnerId:ID});
 assert.equal(result.status,200);
 assert.equal(result.data.status,'stalled');
 assert.equal(h.state().runners.length,1);
 assert.equal(h.state().runners[0].decommission.phase,'failed');
 assert.equal(h.state().hostActions[0].status,'expired');
});
test('Successful validation clears stale removal and retains recovery audit',async()=>{
 const h=harness({online:true,registered:true,actions:[{
  id:'provisioned',runnerId:ID,organization:'MainCreate',runnerName:'builder-linux-arm64-01',status:'completed'
 }]});
 const s=h.state();s.runners[0].managedHost={host:'192.168.100.200'};
 s.runners[0].decommission={phase:'stopping',mode:'managed',error:null};h.setState(s);
 const old=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({total_count:1,runners:[
  {id:21,name:'builder-linux-arm64-01',status:'online',busy:false}]});
 try{
  const result=await h.call('/api/local/builders/validate',{runnerId:ID});
  assert.equal(result.data.ready,true);
  assert.equal(h.state().runners[0].decommission,undefined);
  assert.equal(h.state().builderRecoveryAudit.length,1);
 }finally{globalThis.fetch=old;}
});

test('Remote upgrade requires a managed, reachable, protocol-capable host',async()=>{
 const h=harness({online:true,registered:true});
 assert.equal((await h.call('/api/local/builders/upgrade',{runnerId:ID})).status,422);
 const s=h.state();s.runners[0].managedHost={host:'192.168.100.200'};
 s.runners[0].hostVersion='0.4.0';h.setState(s);
 const legacy=await h.call('/api/local/builders/upgrade',{runnerId:ID});
 assert.equal(legacy.status,409);
 assert.match(legacy.data.error,/once/i);
 assert.equal(h.state().hostActions.length,0);
 const fresh=h.state();fresh.runners[0].hostVersion='0.5.0';h.setState(fresh);
 assert.equal((await h.call('/api/local/builders/upgrade',{runnerId:ID})).status,409);
});
test('Successful staged upgrade acknowledgement requires a new heartbeat for completion',async()=>{
 const h=harness({online:true,registered:true,actions:[{
  id:'upgrade-job',type:'host.upgrade',runnerId:ID,runnerName:'builder-linux-arm64-01',
  status:'claimed',targetVersion:'0.6.0',sha256:'a'.repeat(64),
  expiresAt:new Date(Date.now()+60000).toISOString()
 }]});
 const s=h.state();s.runners[0].upgrade={phase:'queued',targetVersion:'0.6.0',actionId:'upgrade-job'};
 h.setState(s);
 const result=await h.call('/api/agent/actions/complete',{id:ID,action_id:'upgrade-job',success:true,message:'staged'},true);
 assert.equal(result.status,200);
 assert.equal(h.state().runners[0].upgrade.phase,'installing');
 assert.equal(h.state().hostActions[0].status,'completed');
});

test('Removal status reports four ordered stages and preserves completed audit',async()=>{
 const h=harness({online:true});
 const initial=await h.removal();
 assert.equal(initial.status,200);
 const queued=h.state();
 const progress=removalTimeline(queued.runners[0],queued.hostActions);
 assert.deepEqual(progress.stages.map(s=>s.id),['stopping','unregistering','cleaning','controller']);
 assert.equal(progress.stages.find(s=>s.id==='stopping').status,'skipped');
 assert.equal(progress.stages.find(s=>s.id==='cleaning').status,'active');
 assert.equal(progress.stages.find(s=>s.id==='controller').status,'pending');
 const status=await h.call('/api/local/builders/remove/status',{id:ID});
 assert.equal(status.status,200);
 const claimed=await h.call('/api/agent/actions/claim',{id:ID},true);
 await h.call('/api/agent/actions/complete',{
  id:ID,action_id:claimed.data.action.id,success:true,message:'cleanup scheduled'
 },true);
 const end=removalTimeline(null,[],h.state().builderRemovalAudit[0]);
 assert.equal(end.removed,true);
 assert.equal(end.stages.find(s=>s.id==='stopping').status,'skipped');
 assert.equal(end.stages.find(s=>s.id==='controller').status,'completed');
});
test('Removal errors identify the failing stage for manual recovery',async()=>{
 const h=harness({online:true});
 await h.removal();
 const claimed=await h.call('/api/agent/actions/claim',{id:ID},true);
 await h.call('/api/agent/actions/complete',{
  id:ID,action_id:claimed.data.action.id,success:false,message:'Host cleanup unavailable'
 },true);
 const saved=h.state();
 const timeline=removalTimeline(saved.runners[0],saved.hostActions);
 assert.equal(timeline.phase,'failed');
 assert.equal(timeline.stages.find(s=>s.id==='cleaning').status,'failed');
 assert.match(timeline.stages.find(s=>s.id==='cleaning').detail,/cleanup unavailable/);
 assert.equal(timeline.stages.find(s=>s.id==='controller').status,'pending');
});
