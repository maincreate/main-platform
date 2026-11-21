import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const dir=mkdtempSync(join(tmpdir(),"maincreate-upgrade-fabric-"));
process.env.MAIN_DATA_DIR=dir;
const {fabricCall,runnerHasExecutableFabricWork,claimJob,reportJob}=await import("./fabric.mjs");
const {queueManagedHostUpgrade,pendingHostUpgrade,HOST_RELEASE}=await import("./host_routes.mjs");
const now=()=>new Date().toISOString();
const host=(id,caps=["host.snapshot"])=>({
 id,name:"linux-host-"+id,os:"linux",arch:"x64",hostVersion:"0.8.7",
 lastSeen:now(),fabricObservedAt:now(),fabricCapabilities:caps,managedHost:{}
});
const context=r=>({runners:[r]});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test("Queued and claimed jobs defer automatic Host upgrades until execution finishes",()=>{
 assert.equal(HOST_RELEASE,"0.8.15");
 const runner=host("a");
 const planned=fabricCall("maincreate_plan",{capability:"host.snapshot",runner_id:runner.id,parameters:{}},context(runner));
 const job=fabricCall("maincreate_execute",{plan_id:planned.plan_id},context(runner)).job;
 assert.equal(job.status,"queued");
 assert.equal(runnerHasExecutableFabricWork(runner),true);
 const st={hostActions:[]};
 assert.equal(queueManagedHostUpgrade(st,runner,()=> "upgrade-1",{fabricBusy:runnerHasExecutableFabricWork(runner),binaryHash:"a".repeat(64)}),null);
 assert.equal(st.hostActions.length,0);
 const claimed=claimJob(runner,["host.snapshot"]);
 assert.equal(claimed.job.id,job.id);
 assert.equal(runnerHasExecutableFabricWork(runner),true);
 assert.equal(queueManagedHostUpgrade(st,runner,()=> "upgrade-1",{fabricBusy:runnerHasExecutableFabricWork(runner),binaryHash:"a".repeat(64)}),null);
 const finished=reportJob(runner,{job_id:job.id,success:true,logs:"ok",
  steps:[{capability:"host.snapshot",status:"completed"}]});
 assert.equal(finished.job.status,"completed");
 assert.equal(runnerHasExecutableFabricWork(runner),false);
 const action=queueManagedHostUpgrade(st,runner,()=> "upgrade-1",{fabricBusy:runnerHasExecutableFabricWork(runner),binaryHash:"a".repeat(64)});
 assert.equal(action.type,"host.upgrade");
 assert.equal(action.targetVersion,HOST_RELEASE);
 assert.equal(pendingHostUpgrade(st,runner.id),true);
 assert.equal(pendingHostUpgrade(st,"other"),false);
 const future=new Date(Date.now()+11*60*1000).getTime();
 assert.equal(pendingHostUpgrade(st,runner.id,future),false);
});
test("Unsupported queued capability does not block Host update needed to enable it",()=>{
 const runner=host("b",["host.snapshot"]);
 const planned=fabricCall("maincreate_plan",{
  capability:"sdk.arduino_cli.install",runner_id:runner.id,parameters:{}
 },context(runner));
 const job=fabricCall("maincreate_execute",{plan_id:planned.plan_id},context(runner)).job;
 assert.equal(job.status,"queued");
 assert.equal(runnerHasExecutableFabricWork(runner),false);
 const st={hostActions:[]};
 const queued=queueManagedHostUpgrade(st,runner,()=> "upgrade-b",{
  fabricBusy:runnerHasExecutableFabricWork(runner),binaryHash:"b".repeat(64)});
 assert.equal(queued.type,"host.upgrade");
});
