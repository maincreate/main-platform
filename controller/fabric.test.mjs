import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";

const dir=mkdtempSync(join(tmpdir(),"maincreate-fabric-"));
process.env.MAIN_DATA_DIR=dir;
const {fabricCall,approveJob,claimJob,reportJob,agentAsset,importReviewedFirmwareBuild}=await import("./fabric.mjs");
const runner={id:"a".repeat(24),name:"approved-pi",os:"linux",arch:"arm64",lastSeen:new Date().toISOString()};
const other={id:"b".repeat(24),name:"other-pi",os:"linux",arch:"arm64",lastSeen:new Date().toISOString()};
const ctx={runners:[runner,other],workspace:{name:"Test",githubOrganization:"Example"}};
const invoke=(tool,args)=>fabricCall(tool,args,ctx);
const snapshot={capability:"host.snapshot",runner_id:runner.id,parameters:{}};
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test("registry exposes approved device-write capability without automatic execution",()=>{
 const {capabilities,workspace,runners}=invoke("maincreate_discover",{resource:"all"});
 assert.equal(workspace.githubOrganization,"Example");
 assert.equal(runners.length,2);
 assert(capabilities.some(c=>c.id==="host.snapshot"&&c.state==="available"));
 assert(capabilities.some(c=>c.id==="firmware.esp_idf.build"&&c.state==="available"));
 assert(capabilities.some(c=>c.id==="sdk.arduino_cli.install"&&c.state==="available"));
 assert(capabilities.some(c=>c.id==="workflow.esp_idf.preflight_build"&&c.kind==="workflow"));
 assert(capabilities.some(c=>c.id==="firmware.esp_idf.flash"&&c.state==="available"));
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.flash",runner_id:runner.id,parameters:{}}),/Missing parameter: port/);
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
test("ESP-IDF installation requires an exact approved version",()=>{
 const good=invoke("maincreate_plan",{capability:"sdk.esp_idf.install",runner_id:runner.id,
  parameters:{version:"5.5.6"}});
 assert.equal(good.parameters.version,"5.5.6");
 for(const version of ["latest","5.5","6.4","../5.5.6","5.5.6;sh"]){
  assert.throws(()=>invoke("maincreate_plan",{capability:"sdk.esp_idf.install",runner_id:runner.id,
   parameters:{version}}),/Invalid parameter: version/);
 }
 assert.throws(()=>invoke("maincreate_plan",{capability:"sdk.esp_idf.install",runner_id:runner.id,
  parameters:{}}),/Missing parameter: version/);
});
test("Fixed ESP32-S3 smoke build enforces EIM-managed ESP-IDF v5.5.6",()=>{
 const good=invoke("maincreate_plan",{capability:"firmware.esp_idf.smoke_build",runner_id:runner.id,
  parameters:{version:"5.5.6"}});
 assert.equal(good.parameters.version,"5.5.6");
 assert.deepEqual(good.steps.map(s=>s.capability),["firmware.esp_idf.smoke_build"]);
 assert.equal(good.requires_approval,false);
 for(const version of ["","5.5.5","6.1.1","latest","5.5.6;sh"]){
  assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.smoke_build",runner_id:runner.id,
   parameters:{version}}),/Invalid parameter: version/);
 }
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.smoke_build",runner_id:runner.id,
  parameters:{}}),/Missing parameter: version/);
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.smoke_build",runner_id:runner.id,
  parameters:{version:"5.5.6",command:"rm -rf /"}}),/Unsupported parameter/);
});
test("read-only ESP32 probe is typed and does not enable writes",()=>{
 const capability=invoke("maincreate_discover",{resource:"capabilities"}).capabilities.find(x=>x.id==="firmware.esp_idf.probe");
 assert.equal(capability.state,"available");
 assert.equal(capability.risk,"read");
 const planned=invoke("maincreate_plan",{capability:"firmware.esp_idf.probe",runner_id:runner.id,parameters:{port:"/dev/ttyACM0"}});
 assert.equal(planned.parameters.port,"/dev/ttyACM0");
 assert.deepEqual(planned.steps.map(s=>s.capability),["firmware.esp_idf.probe"]);
 for(const port of ["/dev/ttyS0","/tmp/ttyUSB0","/dev/ttyUSB0;sh","/dev/ttyUSB0 --help","/dev/ttyUSB0/../ttyUSB1"]){
  assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.probe",runner_id:runner.id,parameters:{port}}),/Invalid parameter: port/);
 }
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.probe",runner_id:runner.id,parameters:{}}),/Missing parameter: port/);
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.probe",runner_id:runner.id,parameters:{port:"/dev/ttyUSB0",command:"flash"}}),/Unsupported parameter/);
 assert.throws(()=>invoke("maincreate_plan",{capability:"firmware.esp_idf.flash",runner_id:runner.id,parameters:{}}),/Missing parameter: port/);
});
test("ESP32 full-chip backup is read-only, bound to a canonical MAC and cannot substitute for flashing",()=>{
 const caps=invoke("maincreate_discover",{resource:"capabilities"}).capabilities;
 const cap=caps.find(c=>c.id==="firmware.esp_idf.backup");
 assert.equal(cap.state,"available");
 assert.equal(cap.risk,"device-read");
 const good=invoke("maincreate_plan",{capability:cap.id,runner_id:runner.id,
  parameters:{port:"/dev/ttyACM0",expected_mac:"44:bd:8d:78:15:e8"}});
 assert.deepEqual(good.steps.map(s=>s.capability),["firmware.esp_idf.backup"]);
 for(const expected_mac of ["44:BD:8D:78:15:E8","44:bd:8d:78:15:e8;sh","unknown","ff:ff:ff"]){
  assert.throws(()=>invoke("maincreate_plan",{capability:cap.id,runner_id:runner.id,
   parameters:{port:"/dev/ttyACM0",expected_mac}}),/Invalid parameter: expected_mac/);
 }
 assert.throws(()=>invoke("maincreate_plan",{capability:cap.id,runner_id:runner.id,
  parameters:{port:"/dev/ttyACM0"}}),/Missing parameter: expected_mac/);
 assert.throws(()=>invoke("maincreate_plan",{capability:cap.id,runner_id:runner.id,
  parameters:{port:"/dev/ttyACM0",expected_mac:"44:bd:8d:78:15:e8",command:"write_flash"}}),/Unsupported parameter/);
 assert.equal(caps.find(c=>c.id==="firmware.esp_idf.flash").state,"available");
});
test("security interrogation is read-only, MAC-bound and cannot enable a firmware write",()=>{
 const c=invoke("maincreate_discover",{resource:"capabilities"}).capabilities.find(x=>x.id==="firmware.esp_idf.security_preflight");
 assert.equal(c.state,"available");
 assert.equal(c.risk,"read");
 const plan=invoke("maincreate_plan",{capability:c.id,runner_id:runner.id,
  parameters:{port:"/dev/ttyACM0",expected_mac:"44:bd:8d:78:15:e8"}});
 assert.equal(plan.parameters.expected_mac,"44:bd:8d:78:15:e8");
 assert.deepEqual(plan.steps.map(s=>s.capability),[c.id]);
 for(const expected_mac of ["", "44:BD:8D:78:15:E8","44:bd:8d:78:15:e8;sh"]){
  assert.throws(()=>invoke("maincreate_plan",{capability:c.id,runner_id:runner.id,
   parameters:{port:"/dev/ttyACM0",expected_mac}}),/Invalid parameter: expected_mac/);
 }
 assert.equal(invoke("maincreate_discover",{resource:"capabilities"}).capabilities.find(x=>x.id==="firmware.esp_idf.flash").state,"available");
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

test("running flash job may read only immutable, explicitly bound firmware source assets",()=>{
 const data=Buffer.from("verified source build bytes");
 const buildPlan=invoke("maincreate_plan",{capability:"firmware.esp_idf.smoke_build",runner_id:runner.id,
  parameters:{version:"5.5.6"}});
 const build=invoke("maincreate_execute",{plan_id:buildPlan.plan_id}).job;
 const asset=invoke("maincreate_assets",{action:"begin",name:"esp32s3-firmware.bin",
  size:data.length,mime:"application/octet-stream"}).asset;
 invoke("maincreate_assets",{action:"chunk",asset_id:asset.id,offset:0,content_base64:data.toString("base64")});
 invoke("maincreate_assets",{action:"finish",asset_id:asset.id,sha256:createHash("sha256").update(data).digest("hex")});
 const flashPlan=invoke("maincreate_plan",snapshot);
 const flash=invoke("maincreate_execute",{plan_id:flashPlan.plan_id}).job;
 const file=join(dir,"fabric.json"),s=JSON.parse(readFileSync(file,"utf8"));
 const source=s.jobs.find(x=>x.id===build.id),target=s.jobs.find(x=>x.id===flash.id);
 source.status="completed";source.assetIds=[asset.id];
 target.status="running";target.capability="firmware.esp_idf.flash";target.parameters={source_job_id:build.id};
 s.assets.find(x=>x.id===asset.id).jobId=build.id;
 writeFileSync(file,JSON.stringify(s));
 const granted=agentAsset(runner,{job_id:flash.id,action:"source_get",source_job_id:build.id,
  name:"esp32s3-firmware.bin",offset:0,length:data.length});
 assert.equal(Buffer.from(granted.content_base64,"base64").toString(),data.toString());
 for(const bad of [{source_job_id:"0".repeat(32)},{name:"../../secrets"},{name:"esp32s3-other.bin"}]){
  assert.throws(()=>agentAsset(runner,{job_id:flash.id,action:"source_get",
   source_job_id:build.id,name:"esp32s3-firmware.bin",...bad}),/not authorized|not approved/);
 }
 assert.throws(()=>agentAsset(other,{job_id:flash.id,action:"source_get",source_job_id:build.id,
  name:"esp32s3-firmware.bin"}),/does not own/);
 target.capability="host.snapshot";writeFileSync(file,JSON.stringify(s));
 assert.throws(()=>agentAsset(runner,{job_id:flash.id,action:"source_get",source_job_id:build.id,
  name:"esp32s3-firmware.bin"}),/not authorized/);
});

test("pending device-write approval is never silently promoted when a runner reconnects",()=>{
 const p=invoke("maincreate_plan",snapshot),j=invoke("maincreate_execute",{plan_id:p.plan_id}).job;
 const file=join(dir,"fabric.json"),s=JSON.parse(readFileSync(file,"utf8"));
 const pending=s.jobs.find(x=>x.id===j.id);
 pending.capability="firmware.esp_idf.flash";
 pending.status="awaiting_approval";
 pending.steps=[{index:0,capability:"firmware.esp_idf.flash",status:"pending"}];
 writeFileSync(file,JSON.stringify(s));
 claimJob(runner,["firmware.esp_idf.flash"]);
 assert.equal(invoke("maincreate_jobs",{action:"get",job_id:j.id}).job.status,"awaiting_approval");
});

test("flash approval requires exact target MAC even after authenticated submit",()=>{
 const plan=invoke("maincreate_plan",snapshot),job=invoke("maincreate_execute",{plan_id:plan.plan_id}).job;
 const file=join(dir,"fabric.json"),s=JSON.parse(readFileSync(file,"utf8"));
 const proposed=s.jobs.find(j=>j.id===job.id);
 proposed.capability="firmware.esp_idf.flash";
 proposed.parameters={expected_mac:"44:bd:8d:78:15:e8",port:"/dev/ttyACM0",source_job_id:"f".repeat(32)};
 proposed.status="awaiting_approval";
 proposed.steps=[{index:0,capability:"firmware.esp_idf.flash",status:"pending"}];
 writeFileSync(file,JSON.stringify(s));
 assert.throws(()=>approveJob(job.id,"approve"),/Exact device MAC/);
 assert.throws(()=>approveJob(job.id,"approve","11:22:33:44:55:66"),/Exact device MAC/);
 assert.equal(invoke("maincreate_jobs",{action:"get",job_id:job.id}).job.status,"awaiting_approval");
 assert.throws(()=>approveJob(job.id,"approve","44:bd:8d:78:15:e8"),/Flash preflight blocked/);
 assert.equal(invoke("maincreate_jobs",{action:"get",job_id:job.id}).job.status,"awaiting_approval");
});

test("authenticated external Arduino source becomes immutable, completed flash evidence",()=>{
 const images={
  "esp32s3-bootloader.bin":Buffer.alloc(2048,1),
  "esp32s3-partitions.bin":Buffer.alloc(2048,2),
  "esp32s3-firmware.bin":Buffer.alloc(4096,3),
 };
 const args={repository:"BuilderBench/esp32-expression",revision:"a".repeat(40),
  runId:44961900475,runnerId:"b".repeat(32),images,sourceSha256:"c".repeat(64)};
 const imported=importReviewedFirmwareBuild(args);
 assert.equal(imported.created,true);
 assert.equal(imported.job.capability,"firmware.esp_idf.import_build");
 assert.equal(imported.job.status,"completed");
 const assets=invoke("maincreate_assets",{action:"list",job_id:imported.job.id}).assets;
 assert.deepEqual(new Set(assets.map(a=>a.name)),new Set([
  "esp32s3-bootloader.bin","esp32s3-partitions.bin",
  "esp32s3-firmware.bin","esp32s3-firmware-manifest.json"
 ]));
 assert.equal(assets.every(x=>x.complete&&x.sha256.length===64),true);
 assert.equal(importReviewedFirmwareBuild(args).created,false);
 assert.throws(()=>importReviewedFirmwareBuild({...args,runId:44961900476,
  revision:"x".repeat(40)}),/provenance required/);
});
