import {test} from "node:test";
import assert from "node:assert/strict";
import {firmwareWorkflowPreview,provisionRunnerLabel,ensureRunnerLabel,labelForGithubRunnerId} from "./github_workflow_routing.mjs";

const projects=[{fullName:"maincreate/WaymarkerOS",private:true,archived:false,defaultBranch:"main"},
 {fullName:"maincreate/public-project",private:false,archived:false,defaultBranch:"main"}];
const pi={id:"pi",name:"pi-builder",os:"linux",arch:"arm64",managedHost:{id:"host-pi"},
 githubRunnerName:"pi-builder",lastSeen:new Date().toISOString()};
const x64={id:"x64",name:"x64-builder",os:"linux",arch:"x64",managedHost:{id:"host-x64"},
 githubRunnerName:"x64-builder",lastSeen:new Date().toISOString()};
const route={organization:"maincreate",repository:"maincreate/WaymarkerOS",buildBuilderId:"pi",
 buildTrigger:"github-actions",sdk:{family:"esp-idf",version:"5.5.6"}};
const ctx=(patch={})=>({organization:"maincreate",project:projects[0],builder:pi,route:{...route,...patch}});

test("Unique GitHub label includes exact numeric org runner ID",()=>{
 assert.equal(labelForGithubRunnerId(1234),"maincreate-host-1234");
 for(const x of [-1,0,1.5,"1234"])assert.throws(()=>labelForGithubRunnerId(x));
});

test("Workflow preview waits for a unique GitHub runner label",()=>{
 const preview=firmwareWorkflowPreview(ctx());
 assert.equal(preview.ready,false);
 assert.equal(preview.workflow,null);
 assert.equal(preview.needsLabelProvisioning,true);
});

test("ESP-IDF workflow separates build and manually dispatched device operations",()=>{
 const preview=firmwareWorkflowPreview(ctx({
  githubRunnerId:1234,githubRunnerName:"pi-builder",githubRunnerLabel:"maincreate-host-1234",
  flashBuilderId:"pi",githubFlashRunnerId:1234,githubFlashRunnerName:"pi-builder",githubFlashRunnerLabel:"maincreate-host-1234"
 }),);
 assert.equal(preview.ready,true);
 assert.equal(preview.filePath,".github/workflows/maincreate-device-pipeline.yml");
 assert.match(preview.workflow,/uses: maincreate\/main-platform\/\.github\/workflows\/build-esp-idf\.yml@main/);
 assert.match(preview.workflow,/uses: maincreate\/main-platform\/\.github\/workflows\/device-operations\.yml@main/);
 assert.match(preview.workflow,/push:\n    branches: \[main\]/);
 assert.match(preview.workflow,/workflow_dispatch:/);
 assert.match(preview.workflow,/esp32-flash/);
 assert.match(preview.workflow,/expected_chip_mac/);
 assert.match(preview.workflow,/confirm_device_write/);
 assert.match(preview.workflow,/artifact_run_id/);
 assert.match(preview.safety,/fresh device identity check/);
 assert.ok(!preview.workflow.includes("idf.py flash"));
});

test("Android API 22 route generates APK build and ADB device workflow on different hosts",()=>{
 const androidRoute={organization:"maincreate",repository:"maincreate/WaymarkerOS",buildBuilderId:"x64",
  buildTrigger:"github-actions",sdk:{family:"android-sdk",version:"2026.2.2-patch1"},
  targetProfile:"android-legacy-api22-eink",flashBuilderId:"pi",
  githubRunnerId:200,githubRunnerName:"x64-builder",githubRunnerLabel:"maincreate-host-200",
  githubFlashRunnerId:128,githubFlashRunnerName:"pi-builder",githubFlashRunnerLabel:"maincreate-host-128"};
 const preview=firmwareWorkflowPreview({organization:"maincreate",project:projects[0],builder:x64,
  flashBuilder:pi,route:androidRoute});
 assert.equal(preview.ready,true);
 assert.match(preview.workflow,/build-android\.yml@main/);
 assert.match(preview.workflow,/android-install/);
 assert.match(preview.workflow,/android-legacy-api22-eink/);
 assert.match(preview.workflow,/device_serial/);
 assert.equal(preview.runnerLabel,"maincreate-host-200");
 assert.equal(preview.deviceRunnerLabel,"maincreate-host-128");
});

test("Reject public repo, cross-org routes, unsupported SDK and incompatible builder",()=>{
 for(const badCtx of [
  {...ctx(),project:projects[1],route:{...route,repository:"maincreate/public-project"}},
  {...ctx(),organization:"otherorg"},
  ctx({sdk:{family:"esp-idf",version:"6.4.0"}}),
  ctx({buildTrigger:"manual"}),
  {...ctx(),builder:{...pi,managedHost:null}},
  {...ctx(),builder:{...pi,githubRunnerName:""}},
  {...ctx(),builder:{...pi,os:"macos",arch:"arm64"}}
 ])assert.throws(()=>firmwareWorkflowPreview(badCtx));
});

test("GitHub label provisioning verifies runner identity, existing labels and adds only the scoped host label",async()=>{
 const urls=[],methods=[],label="maincreate-host-128";
 const fakeFetch=async(url,opts)=>{
  urls.push(url);methods.push(opts.method||"GET");
  if(url.endsWith("/labels")&&opts.method!=="POST")
   return new Response(JSON.stringify({labels:[]}),{status:200});
  if(opts.method==="POST"){
   assert.equal(opts.headers.authorization,"Bearer test-github-oauth-token-long-enough");
   assert.deepEqual(JSON.parse(opts.body),{labels:[label]});
   return new Response(JSON.stringify({labels:[{name:label}]}),{status:200});
  }
  return new Response(JSON.stringify({runners:[{id:128,name:"pi-builder",status:"online"}]}),{status:200});
 };
 const result=await provisionRunnerLabel({...ctx({githubRunnerId:128,githubRunnerName:"pi-builder",githubRunnerLabel:label}),
  token:"test-github-oauth-token-long-enough",fetchImpl:fakeFetch});
 assert.equal(result.label,label);
 assert.equal(methods.join(","),"GET,GET,POST");
 assert.match(urls[0],/orgs\/maincreate\/actions\/runners\?per_page=100/);
 assert.equal(urls[2],"https://api.github.com/orgs/maincreate/actions/runners/128/labels");
});

test("Runner labels already present do not trigger another POST",async()=>{
 const label="maincreate-host-128",methods=[];
 const fakeFetch=async(url,opts)=>{
  methods.push(opts.method||"GET");
  if(url.endsWith("/labels"))return new Response(JSON.stringify({labels:[{name:label}]}),{status:200});
  return new Response(JSON.stringify({runners:[{id:128,name:"pi-builder",status:"online"}]}),{status:200});
 };
 const result=await ensureRunnerLabel({builder:pi,organization:"maincreate",token:"test-github-oauth-token-long-enough",fetchImpl:fakeFetch});
 assert.equal(result.label,label);assert.equal(methods.join(","),"GET,GET");
});

test("Runner label provision refuses missing/offline runner",async()=>{
 for(const runners of [[],[{id:1,name:"pi-builder",status:"offline"}],[{id:1,name:"different-builder",status:"online"}]]){
  const fakeFetch=async()=>new Response(JSON.stringify({runners}),{status:200});
  await assert.rejects(()=>provisionRunnerLabel({...ctx({githubRunnerId:128,githubRunnerName:"pi-builder",githubRunnerLabel:"maincreate-host-128"}),
   token:"test-github-oauth-token-long-enough",fetchImpl:fakeFetch}));
 }
});
