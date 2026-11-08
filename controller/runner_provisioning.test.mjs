import test from "node:test";
import assert from "node:assert/strict";
import {runnerIdentity,runnerLabels,queueRunnerProvisioning} from "./runner_provisioning.mjs";

function harness({online=true,authorized=true}={}){
 const s={runners:[{id:"machine-a",name:"waymarker-lab-01",os:"linux",arch:"arm64",
  managedHost:{host:"192.168.100.23",pairedAt:new Date().toISOString()},
  lastSeen:online?new Date().toISOString():null,packages:[]}],
  hostActions:[],github:authorized?{selectedOrganization:"MainCreate",oauthToken:{encrypted:true},
   oauthOrganizations:[{login:"MainCreate",installationId:10}],oauthUser:{login:"tester"}}:{}};
 let writes=0;
 const ctx={state:()=>s,save:()=>{writes++},seal:s=>({cipher:s}),unseal:()=> "server-side-user-token",
  githubIdentityCurrent:gh=>!!gh.oauthUser,rnd:()=>"controller-action-a"};
 return {s,ctx,get writes(){return writes}};
}
test("runner name is exactly the machine hostname from Pi Imager",()=>{
 const {s}=harness();
 assert.equal(runnerIdentity(s.runners[0]),"waymarker-lab-01");
 assert.deepEqual(runnerLabels(s.runners[0]),["maincreate-managed","maincreate-linux","maincreate-arm64"]);
 s.runners[0].name="bad hostname";
 assert.throws(()=>runnerIdentity(s.runners[0]),/hostname/);
});
test("GitHub tokens remain controller-owned and pending action is idempotent",async()=>{
 const {s,ctx}=harness({online:false});
 const oldFetch=globalThis.fetch;let requests=0;
 try{
  globalThis.fetch=async(url,options)=>{
   requests++;
   assert.equal(url,"https://api.github.com/orgs/MainCreate/actions/runners/registration-token");
   assert.equal(options.headers.authorization,"Bearer server-side-user-token");
   return new Response(JSON.stringify({token:"one-time-runner-registration-token",
    expires_at:new Date(Date.now()+15*60*1000).toISOString()}),{status:201});
  };
  const first=await queueRunnerProvisioning("machine-a",ctx,{permitPendingHeartbeat:true});
  assert.equal(first.runnerName,"waymarker-lab-01");
  assert.equal(first.status,"queued");
  assert.equal(first.labels.includes("maincreate-arm64"),true);
  assert.equal(s.hostActions[0].secret.cipher,"one-time-runner-registration-token");
  assert.equal(JSON.stringify(first).includes("one-time-runner-registration-token"),false);
  const again=await queueRunnerProvisioning("machine-a",ctx,{permitPendingHeartbeat:true});
  assert.equal(again.existing,true);
  assert.equal(requests,1);
 }finally{globalThis.fetch=oldFetch}
});
test("retry is blocked while the paired host is offline",async()=>{
 const {ctx}=harness({online:false});
 await assert.rejects(()=>queueRunnerProvisioning("machine-a",ctx),/online/);
});
test("GitHub registration permission failure leaves host enrollment intact",async()=>{
 const {s,ctx}=harness();
 const old=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({message:"Resource not accessible by integration"}),{status:403});
  await assert.rejects(()=>queueRunnerProvisioning("machine-a",ctx),/Self-hosted runners: write/);
  assert.ok(s.runners[0].managedHost);assert.equal(s.hostActions.length,0);
 }finally{globalThis.fetch=old}
});
test("org must be authorized and selected before token is requested",async()=>{
 const {ctx}=harness({authorized:false});
 await assert.rejects(()=>queueRunnerProvisioning("machine-a",ctx),/Connect GitHub/);
});
