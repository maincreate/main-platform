/**
 * Persistent repository → builder → device routing policy.
 * Configuration only. It NEVER triggers a GitHub Actions job or writes to USB.
 * Flash adapters must check actual hardware identity immediately before execution.
 */
import {releases,classifyBuilder} from "./marketplace_planning.mjs";

const bad=(message,status=422)=>Object.assign(new Error(message),{status});
const namePattern=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const allowableKeys=new Set(["repository","buildBuilderId","buildTrigger","sdkFamily","sdkVersion",
  "flashBuilderId","deviceId","autoFlashRequested"]);
const triggerValues=new Set(["manual","github-actions"]);

function eligible(host){
 return !!host && !!host.managedHost && !host.decommission;
}
const recent=host=>!!(host?.lastSeen&&Date.now()-Date.parse(host.lastSeen)<120000);
const summary=host=>host?{id:host.id,name:host.assignment?.displayName||host.name,
  os:host.os,arch:host.arch,runnerName:host.githubRunnerName||null,online:recent(host)}:null;

export function planBuildFlashRoute(input,{organization,projects=[],builders=[],devices=[]},actor="administrator"){
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>!allowableKeys.has(k)))
   throw bad("Invalid routing policy");
 const {repository,buildBuilderId}=input;
 if(!namePattern.test(repository||"")||!repository.startsWith(organization+"/"))
   throw bad("Choose a repository in the connected GitHub organization");
 const project=projects.find(r=>r.fullName===repository);
 if(!project||project.archived)throw bad("Repository is missing, archived or not synchronized",409);
 if(typeof buildBuilderId!=="string"||!buildBuilderId)
   throw bad("Select a build machine");
 const builder=builders.find(b=>b.id===buildBuilderId);
 if(!eligible(builder))throw bad("Choose an enrolled, managed build machine",409);
 const buildTrigger=input.buildTrigger||"manual";
 if(!triggerValues.has(buildTrigger))throw bad("Unsupported build trigger");
 if(buildTrigger==="github-actions"&&!builder.githubRunnerName)
   throw bad("The selected builder needs a registered GitHub Actions runner",409);

 const sdkFamily=input.sdkFamily||null,sdkVersion=input.sdkVersion||null;
 if((sdkFamily===null)!==(sdkVersion===null))throw bad("Choose both an SDK and its exact release");
 let sdk=null;
 if(sdkFamily!==null){
   const release=releases().find(r=>r.family===sdkFamily&&r.version===sdkVersion);
   if(!release)throw bad("Unknown or unapproved marketplace release");
   const variant=classifyBuilder(builder,release);
   if(!variant.compatible)throw bad("The SDK release does not support that builder OS and architecture",409);
   sdk={family:sdkFamily,version:sdkVersion,readiness:variant.readiness};
 }

 const autoFlashRequested=input.autoFlashRequested===true;
 if(input.autoFlashRequested!==undefined&&typeof input.autoFlashRequested!=="boolean")
   throw bad("Invalid auto-flash selection");
 const flashBuilderId=input.flashBuilderId||null,deviceId=input.deviceId||null;
 if(input.flashBuilderId!==undefined&&input.flashBuilderId!==null&&typeof input.flashBuilderId!=="string")
   throw bad("Invalid flash builder");
 if(input.deviceId!==undefined&&input.deviceId!==null&&typeof input.deviceId!=="string")
   throw bad("Invalid device selection");
 if(deviceId&&!flashBuilderId)throw bad("Select the builder connected to the device");
 if(autoFlashRequested&&(!deviceId||!flashBuilderId))
   throw bad("Auto-flash planning requires a selected flash machine and device");

 let flashBuilder=null,device=null;
 if(flashBuilderId){
   flashBuilder=builders.find(b=>b.id===flashBuilderId);
   if(!eligible(flashBuilder))throw bad("Choose an enrolled, managed flash machine",409);
 }
 if(deviceId){
   device=devices.find(d=>d.id===deviceId);
   if(!device||device.runnerId!==flashBuilderId)throw bad("Device is not associated with the chosen flash machine",409);
 }
 const checks=[
   {key:"builder-online",passed:recent(builder),message:recent(builder)?"Build host is online":"Build host is offline"},
   {key:"github-runner",passed:buildTrigger!=="github-actions"||!!builder.githubRunnerName,
    message:buildTrigger==="github-actions"?"GitHub runner registered":"Manual build trigger selected"},
   {key:"sdk",passed:!!sdk,message:sdk?"SDK release selected (installation still unverified)":"Select a versioned SDK"},
   {key:"artifact-provenance",passed:false,message:"Signed or hash-verified build artifact has not been supplied"},
   {key:"flash-adapter",passed:false,message:"No reviewed device-specific flashing adapter is enabled"}
 ];
 if(flashBuilderId){
   checks.push({key:"flash-builder-online",passed:recent(flashBuilder),
     message:recent(flashBuilder)?"Flash host is online":"Flash host is offline"});
 }
 if(deviceId){
   checks.push({key:"device-identity",passed:false,
     message:"A fresh chip probe and exact board/serial verification are still required"});
 }
 return {
  schema:1,repository,organization,
  buildBuilderId,builder:summary(builder),buildTrigger,
  sdk,flashBuilderId,flashBuilder:summary(flashBuilder),deviceId,
  device:device?{id:device.id,label:device.label||device.description||"USB device",runnerId:device.runnerId,
    connected:!!device.connected,identityConfidence:device.identityConfidence||"unknown"}:null,
  autoFlashRequested,
  autoFlashEnabled:false,
  status:"configuration-only",
  checks,
  note:autoFlashRequested
    ?"Auto-flash is requested but cannot execute: verified artifacts, a fresh device identity check, a reviewed flash adapter and explicit execution authorization are required."
    :"Routing is saved only. Builds run through separately approved GitHub Actions or MCP jobs; flashing is manual until independently validated.",
  updatedBy:actor,updatedAt:new Date().toISOString()
 };
}
export function routeSummaries(records=[],organization,projects=[],builders=[],devices=[]){
 const validProjects=new Set(projects.filter(p=>!p.archived).map(p=>p.fullName));
 return (records||[]).filter(r=>r.organization===organization&&validProjects.has(r.repository))
  .map(r=>{
   const build=builders.find(b=>b.id===r.buildBuilderId);
   const flash=builders.find(b=>b.id===r.flashBuilderId);
   const device=devices.find(d=>d.id===r.deviceId);
   return {...r,builder:summary(build),flashBuilder:summary(flash),
     device:device?{id:device.id,runnerId:device.runnerId,connected:!!device.connected,
       label:device.label||device.description||"USB device"}:null,
     autoFlashEnabled:false,status:"configuration-only"};
  });
}
export function validateRouteRemoval(repository,organization,projects=[]){
 if(!namePattern.test(repository||"")||!repository.startsWith(organization+"/")||
    !projects.some(p=>p.fullName===repository))throw bad("Unknown repository route",404);
 return true;
}
