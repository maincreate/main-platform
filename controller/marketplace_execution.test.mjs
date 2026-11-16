import {test} from "node:test";
import assert from "node:assert/strict";
import {dispatchToolkitInstall,refreshMarketplacePlans,dispatchToolkitCleanup,refreshMarketplaceCleanups} from "./marketplace_execution.mjs";

const token="test-github-oauth-token-long-enough";
const builder={id:"builder-01",name:"builder-linux-x64-01",os:"linux",arch:"x64",managedHost:{id:"host"},
 githubRunnerName:"builder-linux-x64-01",lastSeen:new Date().toISOString()};
const plan={id:"12345678-1234-1234-1234-123456789012",family:"esp-idf",version:"6.1.1",
 installable:true,acceptAndroidSdkLicense:false,targets:[{builderId:builder.id,status:"awaiting_workflow_dispatch"}]};
const runner={id:123,name:builder.githubRunnerName,status:"online"};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});

test("Toolkit install dispatch provisions a unique runner label and exact version workflow",async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,method:opts.method||"GET",body:opts.body});
  if(url.endsWith("?per_page=100&page=1"))return json({runners:[runner]});
  if(url.endsWith("/labels")&&opts.method!=="POST")return json({labels:[]});
  if(url.endsWith("/labels")&&opts.method==="POST")return json({labels:[{name:"maincreate-host-123"}]});
  if(url.endsWith("/toolkit-install.yml/dispatches")){
   assert.deepEqual(JSON.parse(opts.body),{ref:"main",inputs:{
    installation_id:plan.id.slice(0,8)+"-"+builder.id+"-"+JSON.parse(opts.body).inputs.installation_id.split("-").at(-1),
    toolkit_family:"esp-idf",toolkit_version:"6.1.1",runner_label:"maincreate-host-123",accept_android_sdk_license:"false"}});
   return new Response(null,{status:204});
  }
  throw new Error("Unexpected URL "+url);
 };
 const result=await dispatchToolkitInstall({plan,target:plan.targets[0],builder,organization:"maincreate",token,fetchImpl,ref:"main"});
 assert.equal(result.status,"dispatched");assert.equal(result.runnerId,123);
 assert.equal(result.runnerLabel,"maincreate-host-123");
 assert.match(result.workflowRunName,/esp-idf@6\.1\.1/);
 assert.equal(calls.length,4);
});

test("Completed installation registers version and operation labels only after workflow success",async()=>{
 const target={builderId:builder.id,githubRunnerId:123,installationId:"install-123",status:"dispatched"};
 const p={...plan,targets:[target]};
 const fetchImpl=async(url,opts)=>{
  if(url.includes("/toolkit-install.yml/runs"))return json({workflow_runs:[{
   id:456,run_name:"Main{Create} install / install-123 / esp-idf@6.1.1",status:"completed",conclusion:"success",
   html_url:"https://github.com/maincreate/main-platform/actions/runs/456"}]});
  if(url.endsWith("/labels")&&opts.method==="POST"){
   const labels=JSON.parse(opts.body).labels;
   assert(labels.includes("maincreate-toolkit-esp-idf-6-1-1"));
   assert(labels.includes("maincreate-capability-firmware-build"));
   assert(labels.includes("maincreate-target-esp32"));
   return json({labels:labels.map(name=>({name}))});
  }
  throw new Error("Unexpected URL "+url);
 };
 const result=await refreshMarketplacePlans({plans:[p],organization:"maincreate",token,fetchImpl});
 assert.equal(result.changed,true);assert.equal(target.status,"completed");
 assert.equal(target.labelsRegistered,true);assert.equal(target.workflowRunId,456);
});

test("Cleanup dispatch requires confirmation and targets exact installed version",async()=>{
 const installedTarget={...plan.targets[0],status:"completed",labelsRegistered:true};
 const p={...plan,targets:[installedTarget]};
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,method:opts.method||"GET"});
  if(url.endsWith("?per_page=100&page=1"))return json({runners:[runner]});
  if(url.endsWith("/labels"))return json({labels:[{name:"maincreate-host-123"}]});
  if(url.endsWith("/toolkit-cleanup.yml/dispatches"))return new Response(null,{status:204});
  throw new Error("Unexpected URL "+url);
 };
 await assert.rejects(()=>dispatchToolkitCleanup({plan:p,target:installedTarget,builder,organization:"maincreate",token,fetchImpl,confirmCleanup:false}));
 const result=await dispatchToolkitCleanup({plan:p,target:installedTarget,builder,organization:"maincreate",token,fetchImpl,confirmCleanup:true});
 assert.equal(result.status,"dispatched");assert.match(result.workflowRunName,/esp-idf@6\.1\.1/);
 assert.equal(calls.at(-1).method,"POST");
});

test("Successful cleanup removes only the version label and marks that target cleaned",async()=>{
 const target={builderId:builder.id,status:"completed",labelsRegistered:true};
 const p={id:plan.id,family:"esp-idf",version:"6.1.1",targets:[target]};
 const request={cleanupId:"cleanup-123",planId:p.id,family:p.family,version:p.version,builderId:builder.id,
  githubRunnerId:123,status:"dispatched"};
 const deleted=[];
 const fetchImpl=async(url,opts)=>{
  if(url.includes("/toolkit-cleanup.yml/runs"))return json({workflow_runs:[{
   id:789,run_name:"Main{Create} cleanup / cleanup-123 / esp-idf@6.1.1",status:"completed",conclusion:"success",
   html_url:"https://github.com/maincreate/main-platform/actions/runs/789"}]});
  if(url.endsWith("/labels")&&opts.method&&opts.method!=="GET")throw new Error("Expected label read first");
  if(url.endsWith("/labels")&&(!opts.method||opts.method==="GET"))return json({labels:[
   {name:"maincreate-toolkit-esp-idf-6-1-1"},{name:"maincreate-capability-firmware-build"},
   {name:"maincreate-capability-firmware-device-io"},{name:"maincreate-capability-firmware-backup"},{name:"maincreate-capability-firmware-restore"},{name:"maincreate-target-esp32"}]});
  if(opts.method==="DELETE"){deleted.push(url);return new Response(null,{status:200});}
  throw new Error("Unexpected URL "+url);
 };
 const result=await refreshMarketplaceCleanups({requests:[request],plans:[p],organization:"maincreate",token,fetchImpl});
 assert.equal(result.changed,true);assert.equal(request.status,"completed");
 assert.equal(target.status,"cleaned");assert.equal(target.labelsRegistered,false);
 assert.equal(deleted.length,6);
});


test("Cleaning one ESP-IDF version preserves shared labels while another version remains installed",async()=>{
 const target={builderId:builder.id,status:"completed",labelsRegistered:true};
 const p={id:plan.id,family:"esp-idf",version:"6.1.1",targets:[target]};
 const other={id:"other-plan",family:"esp-idf",version:"5.5.6",
  targets:[{builderId:builder.id,status:"completed",labelsRegistered:true}]};
 const request={cleanupId:"cleanup-456",planId:p.id,family:p.family,version:p.version,builderId:builder.id,
  githubRunnerId:123,status:"dispatched"};
 const deleted=[];
 const fetchImpl=async(url,opts)=>{
  if(url.includes("/toolkit-cleanup.yml/runs"))return json({workflow_runs:[{
   id:790,run_name:"Main{Create} cleanup / cleanup-456 / esp-idf@6.1.1",status:"completed",conclusion:"success"}]});
  if(url.endsWith("/labels"))return json({labels:[
   {name:"maincreate-toolkit-esp-idf-6-1-1"},{name:"maincreate-capability-firmware-build"},
   {name:"maincreate-capability-firmware-device-io"},{name:"maincreate-capability-firmware-backup"},
   {name:"maincreate-capability-firmware-restore"},{name:"maincreate-target-esp32"}]});
  if(opts.method==="DELETE"){deleted.push(url);return new Response(null,{status:200});}
  throw new Error("Unexpected URL "+url);
 };
 await refreshMarketplaceCleanups({requests:[request],plans:[p,other],organization:"maincreate",token,fetchImpl});
 assert.equal(target.status,"cleaned");
 assert.equal(deleted.length,1);
 assert(deleted[0].endsWith("/maincreate-toolkit-esp-idf-6-1-1"));
});
