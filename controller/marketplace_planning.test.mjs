import {test} from "node:test";
import assert from "node:assert/strict";
import {releases,classifyBuilder,classifyBuilderForOperation,makeInstallationPlan,validateAssignment} from "./marketplace_planning.mjs";
const now=new Date().toISOString();
const pi={id:"pi",name:"builder-linux-arm64-01",os:"linux",arch:"arm64",managedHost:{host:"pi.local"},
 githubRunnerName:"builder-linux-arm64-01",lastSeen:now,assignment:{location:"rack",assignedTo:"firmware"}};
const x64={id:"x64",name:"builder-linux-x64-01",os:"linux",arch:"x64",managedHost:{host:"x64.local"},
 githubRunnerName:"builder-linux-x64-01",lastSeen:now,assignment:{location:"rack",assignedTo:"firmware"}};
const unmanaged={id:"unmanaged",name:"unmanaged",os:"linux",arch:"arm64"};
const mac={id:"mac",name:"mac",os:"macos",arch:"arm64",managedHost:{host:"mac.local"},
 githubRunnerName:"mac-builder",lastSeen:now};
const hosts=[pi,x64,unmanaged,mac];

test("Marketplace catalog contains pinned ESP-IDF, Android and Arduino releases",()=>{
 const all=releases();
 assert(all.some(x=>x.id==="esp-idf@5.5.6"));
 assert(all.some(x=>x.id==="esp-idf@6.1.1"));
 assert(all.some(x=>x.id==="android-sdk@2026.2.2-patch1"));
 assert(all.some(x=>x.id==="arduino-cli@1.5.1"));
 assert.equal(all.some(x=>x.id==="esp-idf@6.4"),false);
 const esp=all.find(x=>x.id==="esp-idf@6.1.1");
 assert.equal(classifyBuilder(pi,esp).compatible,true);
 assert.equal(classifyBuilder(x64,esp).compatible,true);
 assert.equal(classifyBuilder(unmanaged,esp).compatible,false);
 assert.equal(classifyBuilder(mac,esp).compatible,false);
 const android=all.find(x=>x.id==="android-sdk@2026.2.2-patch1");
 assert.equal(classifyBuilder(x64,android).compatible,true);
 assert.equal(classifyBuilder(pi,android).compatible,false);
 assert.equal(classifyBuilderForOperation(pi,android,"deploy").compatible,true);
 assert.equal(android.deviceProfiles.find(x=>x.id==="android-legacy-api22-eink").apiLevel,22);
});

test("ESP-IDF all-compatible installation selects both enrolled Linux architectures",()=>{
 const plan=makeInstallationPlan({family:"esp-idf",version:"6.1.1",placement:"all-compatible"},hosts,"tester");
 assert.deepEqual(plan.targets.map(x=>x.builderId),["pi","x64"]);
 assert.equal(plan.execution,"not_started");
 assert.equal(plan.status,"planned");
 assert.equal(plan.targets[0].status,"awaiting_workflow_dispatch");
 assert.equal(plan.job_ids,undefined);
});

test("Android SDK installation requires explicit Google license acceptance and selects x64 only",()=>{
 assert.throws(()=>makeInstallationPlan({family:"android-sdk",version:"2026.2.2-patch1",placement:"all-compatible"},hosts,"tester"),/license/);
 const plan=makeInstallationPlan({family:"android-sdk",version:"2026.2.2-patch1",placement:"all-compatible",
  accept_android_sdk_license:true},hosts,"tester");
 assert.deepEqual(plan.targets.map(x=>x.builderId),["x64"]);
 assert.equal(plan.acceptAndroidSdkLicense,true);
});

test("Selected builder plans are side-effect free and require a registered GitHub runner",()=>{
 const plan=makeInstallationPlan({family:"esp-idf",version:"5.5.6",placement:"selected",builder_ids:["pi"]},hosts,"tester");
 assert.equal(plan.targets.length,1);
 assert.equal(plan.targets[0].builderId,"pi");
 assert.equal(plan.execution,"not_started");
 assert.equal(plan.targets[0].status,"awaiting_workflow_dispatch");
 assert.equal(plan.targets[0].githubRunnerName,"builder-linux-arm64-01");
 const noRunner={...pi,githubRunnerName:""};
 assert.throws(()=>makeInstallationPlan({family:"esp-idf",version:"5.5.6",placement:"selected",builder_ids:["pi"]},[noRunner],"tester"),/GitHub Actions runner/);
});

test("All-compatible does not accept selected IDs and rejects unmanaged/unsupported hosts",()=>{
 assert.throws(()=>makeInstallationPlan({family:"esp-idf",version:"5.5.6",placement:"all-compatible",builder_ids:["pi"]},hosts,"tester"));
 assert.throws(()=>makeInstallationPlan({family:"esp-idf",version:"999.0",placement:"selected",builder_ids:["pi"]},hosts,"tester"));
 assert.throws(()=>makeInstallationPlan({family:"esp-idf",version:"5.5.6",placement:"selected",builder_ids:["unmanaged"]},hosts,"tester"));
});

test("Builder metadata is bounded and separated from identity",()=>{
 assert.deepEqual(validateAssignment({displayName:"Pi desk",location:"Rack / Row 1",assignedTo:"Engineer A",accessGroup:"firmware"}),{
  displayName:"Pi desk",location:"Rack / Row 1",assignedTo:"Engineer A",accessGroup:"firmware"
 });
 assert.throws(()=>validateAssignment({displayName:"\n",location:"",assignedTo:"",accessGroup:""}));
});
