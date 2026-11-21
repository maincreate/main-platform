import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";

const dir=mkdtempSync(join(tmpdir(),"maincreate-fabric-"));
process.env.MAIN_DATA_DIR=dir;
const {fabricCall,approveJob,claimJob,reportJob,agentAsset}=await import("./fabric.mjs");
const runner={id:"runner-123",name:"approved-pi",os:"linux",arch:"arm64",lastSeen:new Date().toISOString()};
const other={id:"runner-456",name:"other-pi",os:"linux",arch:"arm64",lastSeen:new Date().toISOString()};
const ctx={runners:[runner,other],workspace:{name:"Test",githubOrganization:"Example"}};
const invoke=(tool,args)=>fabricCall(tool,args,ctx);
const snapshot={capability:"host.snapshot",runner_id:runner.id,parameters:{}};
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test("stable registry discovers real capabilities and marks flashing unavailable",()=>{
 const {capabilities,workspace,runners}=invoke("maincreate_discover",{resource:"all"});
 assert.equal(workspace.githubOrganization,"Example");
 assert.equal(runners.length,2);
 assert(capabilities.some(c=>c.id==="host.snapshot"&&c.state==="available"));
 assert(capabilities.some(c=>c.id==="firmware.esp_idf.build"&&c.state==="available"));
 assert(capabilities.some(c=>c.id==="sdk.arduino_cli.install"&&c.state==="available"));
 assert(capabilities.some(c=>c.id==="workflow.esp_idf.preflight_build"&&c.kind==="workflow"));
 assert(capabilities.some(c=>c.id==="firmware.esp_idf.flash"&&c.state==="unavailable"));
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.flash",runner_id:runner.id,parameters:{}}),/not available/);
});
test("versioned Marketplace registry advertises compatibility without enabling unimplemented SDK execution",()=>{
 const result=invoke("maincreate_discover",{resource:"toolkits"});
 const idf=result.toolkits.find(x=>x.id==="esp-idf");
 assert.equal(idf.schemaVersion,2);
 assert.equal(idf.installation,"maincreate-managed");
 const v=idf.versions.find(x=>x.version==="5.5.6");
 assert(v,"ESP-IDF 5.5.6 needs a versioned recipe");
 assert(v.compatibility.install.some(x=>x.os==="linux"&&x.architecture==="arm64"&&x.status==="supported"));
 assert(v.compatibility.install.some(x=>x.os==="linux"&&x.architecture==="x64"&&x.status==="supported"));
 const caps=invoke("maincreate_discover",{resource:"capabilities"}).capabilities;
 assert.equal(caps.find(x=>x.id==="sdk.esp_idf.install").state,"available");
 assert.deepEqual(caps.find(x=>x.id==="sdk.esp_idf.install").parameters.properties.version.enum,["5.5.6","6.1.1"]);
});
test("MCP reports observed host release state and never invents missing GitHub versions",()=>{
 const enriched={...runner,hostVersion:"0.8.2",hostVersionObservedAt:new Date().toISOString(),
  managedHost:true,githubRunnerName:"builder-linux-arm64-01",labels:["linux-arm64"],
  packages:[{name:"node",version:"v22"}],upgrade:{phase:"completed",targetVersion:"0.8.2"}};
 const local={...ctx,expectedHostVersion:"0.8.2",runners:[enriched,other]};
 const current=fabricCall("maincreate_inspect",{resource:"runner",id:enriched.id},local);
 assert.equal(current.host_service.installed_version,"0.8.2");
 assert.equal(current.host_service.version_status,"current");
 assert.equal(current.host_service.upgrade.phase,"completed");
 assert.equal(current.github_runner.name,"builder-linux-arm64-01");
 assert.deepEqual(current.github_runner.labels,["linux-arm64"]);
 assert.deepEqual(current.packages,[{name:"node",version:"v22"}]);
 assert.equal("tokenHash" in current,false);
 assert.equal("version" in current.github_runner,false);
 const future=fabricCall("maincreate_discover",{resource:"runners"},{
  ...local,expectedHostVersion:"0.8.1"});
 assert.equal(future.runners[0].host_service.version_status,"newer");
 const behind=fabricCall("maincreate_discover",{resource:"runners"},{
  ...local,expectedHostVersion:"0.8.3"});
 assert.equal(behind.runners[0].host_service.version_status,"update_available");
 assert.equal(behind.runners[1].host_service.version_status,"unknown");
});
test("plans validate schemas and do not execute or accept arbitrary commands",()=>{
 const p=invoke("maincreate_plan",snapshot);
 assert.equal(p.requires_approval,false);
 assert.equal(p.steps.length,1);
 assert.equal(p.capability,"host.snapshot");
 assert.throws(()=>invoke("maincreate_plan",{...snapshot,parameters:{command:"sh -c anything"}}),/Unsupported parameter/);
 assert.throws(()=>invoke("maincreate_plan",{...snapshot,runner_id:"unregistered"}),/not enrolled/);
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.build",runner_id:runner.id,parameters:{repository:"Invalid"}}),/Invalid parameter/);
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.build",runner_id:runner.id,parameters:{repository:"org/repo",flags:"--flash"}}),/Unsupported parameter/);
});
test("execution queues a typed job for immediate runner claim",()=>{
 const plan=invoke("maincreate_plan",snapshot),jobResult=invoke("maincreate_execute",{plan_id:plan.plan_id});
 const job=jobResult.job;
 assert.equal(job.status,"queued");
 assert.equal(jobResult.requires_approval,false);
 const duplicate=invoke("maincreate_execute",{plan_id:plan.plan_id});
 assert.equal(duplicate.job.id,job.id);
 assert.throws(()=>approveJob(job.id,"approve"),/already handled/);
 const claimed=claimJob(runner).job;
 assert.equal(claimed.id,job.id);
 assert.equal(claimJob(runner).job,null);
 assert.throws(()=>invoke("maincreate_jobs",{action:"cancel",job_id:job.id}),/Only unclaimed/);
 assert.throws(()=>reportJob(other,{job_id:job.id,success:true,logs:"",steps:claimed.steps.map(x=>({...x,status:"completed"}))}),/No claimed job/);
 assert.throws(()=>reportJob(runner,{job_id:job.id,success:true,logs:"",steps:[]}),/Invalid job step/);
 const done=reportJob(runner,{job_id:job.id,success:true,logs:"Snapshot done",
  steps:claimed.steps.map(x=>({...x,status:"completed"}))}).job;
 assert.equal(done.status,"completed");
 assert.equal(invoke("maincreate_jobs",{action:"get",job_id:job.id}).job.logs,"Snapshot done");
});
test("Arduino installation requests are queued for compatible builders",()=>{
 const plans=[runner,other].map(r=>invoke("maincreate_plan",{capability:"sdk.arduino_cli.install",runner_id:r.id,parameters:{}}));
 const jobs=plans.map(p=>invoke("maincreate_execute",{plan_id:p.plan_id}).job);
 assert.deepEqual(jobs.map(j=>j.status),["queued","queued"]);
 for(const job of jobs)assert.equal(invoke("maincreate_jobs",{action:"cancel",job_id:job.id}).job.status,"cancelled");
});
test("managed Host Service only claims jobs for its advertised adapters",()=>{
 const sdkPlan=invoke("maincreate_plan",{capability:"sdk.arduino_cli.install",runner_id:runner.id,parameters:{}});
 const sdk=invoke("maincreate_execute",{plan_id:sdkPlan.plan_id}).job;
 const snapPlan=invoke("maincreate_plan",snapshot);
 const snap=invoke("maincreate_execute",{plan_id:snapPlan.plan_id}).job;
 const claimed=claimJob(runner,["host.snapshot"]).job;
 assert.equal(claimed.id,snap.id);
 assert.equal(claimJob(runner,["host.snapshot"]).job,null);
 const done=reportJob(runner,{job_id:snap.id,success:true,logs:"native snapshot",
  steps:[{capability:"host.snapshot",status:"completed"}]});
 assert.equal(done.job.status,"completed");
 assert.equal(invoke("maincreate_jobs",{action:"get",job_id:sdk.id}).job.status,"queued");
 assert.equal(claimJob(runner,[]).job,null);
 assert.equal(invoke("maincreate_jobs",{action:"cancel",job_id:sdk.id}).job.status,"cancelled");
});
test("composed workflow queues ordered pinned actions",()=>{
 const p=invoke("maincreate_plan",{capability:"workflow.esp_idf.preflight_build",runner_id:other.id,
  parameters:{repository:"MainCreate/WaymarkerOS",revision:"a".repeat(40)}});
 assert.deepEqual(p.steps.map(x=>x.capability),["host.snapshot","firmware.esp_idf.build"]);
 const j=invoke("maincreate_execute",{plan_id:p.plan_id}).job;
 const claimed=claimJob(other).job;
 assert.equal(claimed.parameters.repository,"MainCreate/WaymarkerOS");
 assert.equal(claimed.steps.length,2);
 const result=reportJob(other,{job_id:j.id,success:false,logs:"Operator disabled build",
  steps:[{capability:"host.snapshot",status:"completed"},{capability:"firmware.esp_idf.build",status:"failed"}]});
 assert.equal(result.job.status,"failed");
 assert.equal(result.job.steps[1].status,"failed");
});
test("queued jobs may be cancelled before claim; handled jobs cannot be approved",()=>{
 const p1=invoke("maincreate_plan",snapshot);
 const j1=invoke("maincreate_execute",{plan_id:p1.plan_id}).job;
 const stopped=invoke("maincreate_jobs",{action:"cancel",job_id:j1.id});
 assert.equal(stopped.job.status,"cancelled");
 const p2=invoke("maincreate_plan",snapshot);
 const j2=invoke("maincreate_execute",{plan_id:p2.plan_id}).job;
 assert.throws(()=>approveJob(j2.id,"reject"),/already handled/);
 assert.equal(invoke("maincreate_jobs",{action:"cancel",job_id:j2.id}).job.status,"cancelled");
});
test("pre-upgrade awaiting approval jobs are resumed without an approval click",()=>{
 const plan=invoke("maincreate_plan",snapshot),created=invoke("maincreate_execute",{plan_id:plan.plan_id}).job;
 const file=join(dir,"fabric.json"),saved=JSON.parse(readFileSync(file,"utf8"));
 const legacy=saved.jobs.find(j=>j.id===created.id);
 assert(legacy);
 legacy.status="awaiting_approval";
 writeFileSync(file,JSON.stringify(saved));
 const claimed=claimJob(runner).job;
 assert.equal(claimed.id,created.id);
 const result=reportJob(runner,{job_id:created.id,success:true,logs:"Legacy job migrated",
  steps:[{capability:"host.snapshot",status:"completed"}]});
 assert.equal(result.job.status,"completed");
});
test("assets preserve offsets, digests, ownership and access boundaries",()=>{
 const payload=Buffer.from("original local test artifact");
 const asset=invoke("maincreate_assets",{action:"begin",name:"build-result.txt",mime:"text/plain",size:payload.length}).asset;
 assert.equal(asset.complete,false);
 assert.throws(()=>invoke("maincreate_assets",{action:"chunk",asset_id:asset.id,offset:1,
   content_base64:payload.toString("base64")}),/offset mismatch/);
 assert.equal(invoke("maincreate_assets",{action:"chunk",asset_id:asset.id,offset:0,
   content_base64:payload.toString("base64")}).received,payload.length);
 const digest=createHash("sha256").update(payload).digest("hex");
 assert.throws(()=>invoke("maincreate_assets",{action:"finish",asset_id:asset.id,sha256:"bad"}),/digest mismatch/);
 assert.equal(invoke("maincreate_assets",{action:"finish",asset_id:asset.id,sha256:digest}).asset.complete,true);
 assert.equal(Buffer.from(invoke("maincreate_assets",{action:"get",asset_id:asset.id,offset:0}).content_base64,"base64").toString(),payload.toString());
 assert.throws(()=>invoke("maincreate_assets",{action:"begin",name:"../escape",size:4}),/filename/);
 assert.throws(()=>invoke("maincreate_assets",{action:"begin",name:"bad",size:9*1024*1024}),/asset size/);
 assert(existsSync(join(dir,"fabric.json")));
 assert(!readFileSync(join(dir,"fabric.json"),"utf8").includes(payload.toString()));
});
test("runner artifacts can be uploaded only to its own running job",()=>{
 const plan=invoke("maincreate_plan",snapshot),j=invoke("maincreate_execute",{plan_id:plan.plan_id}).job;
 claimJob(runner);
 const payload=Buffer.from("snapshot");
 assert.throws(()=>agentAsset(other,{job_id:j.id,action:"begin",size:payload.length,name:"snapshot.txt"}),/does not own/);
 const a=agentAsset(runner,{job_id:j.id,action:"begin",size:payload.length,name:"snapshot.txt"}).asset;
 assert.throws(()=>agentAsset(other,{job_id:j.id,action:"chunk",asset_id:a.id,offset:0,
  content_base64:payload.toString("base64")}),/does not own/);
 agentAsset(runner,{job_id:j.id,action:"chunk",asset_id:a.id,offset:0,content_base64:payload.toString("base64")});
 agentAsset(runner,{job_id:j.id,action:"finish",asset_id:a.id});
 const completed=reportJob(runner,{job_id:j.id,success:true,logs:"ok",
  steps:[{capability:"host.snapshot",status:"completed"}]}).job;
 assert(completed.asset_ids.includes(a.id));
});
