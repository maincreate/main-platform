/**
 * Persistent repository → build runner → device runner routing policy.
 * Configuration and workflow generation only. Physical device operations remain
 * manually dispatched and require a fresh silicon/ADB identity check in the workflow.
 */
import {releases,classifyBuilderForOperation} from "./marketplace_planning.mjs";

const bad=(message,status=422)=>Object.assign(new Error(message),{status});
const namePattern=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const allowableKeys=new Set(["repository","buildBuilderId","buildTrigger","sdkFamily","sdkVersion",
 "flashBuilderId","deviceId","autoFlashRequested","targetProfile"]);
const triggerValues=new Set(["manual","github-actions"]);
const eligible=host=>!!host&&!!host.managedHost&&!host.decommission;
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
 if(typeof buildBuilderId!=="string"||!buildBuilderId)throw bad("Select a build machine");
 const builder=builders.find(b=>b.id===buildBuilderId);
 if(!eligible(builder))throw bad("Choose an enrolled, managed build machine",409);
 const buildTrigger=input.buildTrigger||"manual";
 if(!triggerValues.has(buildTrigger))throw bad("Unsupported build trigger");
 if(buildTrigger==="github-actions"&&!builder.githubRunnerName)
  throw bad("The selected builder needs a registered GitHub Actions runner",409);

 const sdkFamily=input.sdkFamily||null,sdkVersion=input.sdkVersion||null;
 if((sdkFamily===null)!==(sdkVersion===null))throw bad("Choose both a toolkit and its exact release");
 let sdk=null,targetProfile=input.targetProfile||null,release=null;
 if(sdkFamily!==null){
  release=releases().find(r=>r.family===sdkFamily&&r.version===sdkVersion);
  if(!release)throw bad("Unknown or unapproved marketplace release");
  const variant=classifyBuilderForOperation(builder,release,"build");
  if(!variant.compatible)throw bad("The toolkit release does not support builds on that host: "+variant.reason,409);
  if(!targetProfile&&sdkFamily==="android-sdk")targetProfile="android-legacy-api22-eink";
  if(targetProfile&&!release.deviceProfiles.some(p=>p.id===targetProfile))
   throw bad("The selected target profile is not published by this toolkit release");
  sdk={family:sdkFamily,version:sdkVersion,readiness:variant.readiness};
 }

 const autoFlashRequested=input.autoFlashRequested===true;
 if(input.autoFlashRequested!==undefined&&typeof input.autoFlashRequested!=="boolean")
  throw bad("Invalid auto-device-operation selection");
 const flashBuilderId=input.flashBuilderId||null,deviceId=input.deviceId||null;
 if(input.flashBuilderId!==undefined&&input.flashBuilderId!==null&&typeof input.flashBuilderId!=="string")
  throw bad("Invalid device-operation builder");
 if(input.deviceId!==undefined&&input.deviceId!==null&&typeof input.deviceId!=="string")
  throw bad("Invalid device selection");
 if(deviceId&&!flashBuilderId)throw bad("Select the builder connected to the device");
 if(autoFlashRequested&&(!deviceId||!flashBuilderId))
  throw bad("Automatic device operation planning requires a selected device builder and device");

 let flashBuilder=null,device=null,deviceCompatibility=null;
 if(flashBuilderId){
  flashBuilder=builders.find(b=>b.id===flashBuilderId);
  if(!eligible(flashBuilder))throw bad("Choose an enrolled, managed device-operation builder",409);
  if(buildTrigger==="github-actions"&&!flashBuilder.githubRunnerName)
   throw bad("The selected device-operation builder needs a registered GitHub Actions runner",409);
  if(release){
   deviceCompatibility=classifyBuilderForOperation(flashBuilder,release,"deploy");
   if(!deviceCompatibility.compatible)throw bad("The toolkit has no validated deployment adapter for that device builder: "+deviceCompatibility.reason,409);
  }
 }
 if(deviceId){
  device=devices.find(d=>d.id===deviceId||(d.aliases||[]).includes(deviceId));
  if(!device||device.runnerId!==flashBuilderId)throw bad("Device is not associated with the chosen device-operation builder",409);
 }

 const checks=[
  {key:"builder-online",passed:recent(builder),message:recent(builder)?"Build host is online":"Build host is offline"},
  {key:"github-runner",passed:buildTrigger!=="github-actions"||!!builder.githubRunnerName,
   message:buildTrigger==="github-actions"?"GitHub Actions runner registered":"Manual build trigger selected"},
  {key:"toolkit-build",passed:!!sdk,message:sdk?"Exact toolkit and target profile selected":"Select a versioned toolkit"},
  {key:"artifact-provenance",passed:false,message:"Artifact provenance is checked by the reusable build and device workflows"},
  {key:"device-adapter",passed:!!(flashBuilder&&deviceCompatibility?.compatible),
   message:flashBuilder?"Device workflow is available; physical identity still requires a fresh probe":"Select a device-operation builder"}
 ];
 if(flashBuilderId)checks.push({key:"device-builder-online",passed:recent(flashBuilder),
  message:recent(flashBuilder)?"Device builder is online":"Device builder is offline"});
 if(deviceId)checks.push({key:"device-identity",passed:false,
  message:"A fresh ESP32 eFuse MAC or Android ADB serial/API/ABI check is required immediately before any device operation"});
 return {
  schema:2,repository,organization,buildBuilderId,builder:summary(builder),buildTrigger,sdk,targetProfile,
  flashBuilderId,flashBuilder:summary(flashBuilder),deviceId:device?.id||deviceId,
  device:device?{id:device.id,label:device.label||device.description||"USB device",runnerId:device.runnerId,
   connected:!!device.connected,identityConfidence:device.identityConfidence||"unknown",transport:device.transport||"usb-serial"}:null,
  autoFlashRequested,autoFlashEnabled:false,status:"configuration-only",checks,
  note:"The saved route does not run a build or write to a device. Generated workflows separate build and device operations. Flash/install/restore are manually dispatched with an explicit confirmation and a fresh device identity check.",
  updatedBy:actor,updatedAt:new Date().toISOString()
 };
}
export function routeSummaries(records=[],organization,projects=[],builders=[],devices=[]){
 const validProjects=new Set(projects.filter(p=>!p.archived).map(p=>p.fullName));
 return (records||[]).filter(r=>r.organization===organization&&validProjects.has(r.repository)).map(r=>{
  const build=builders.find(b=>b.id===r.buildBuilderId),flash=builders.find(b=>b.id===r.flashBuilderId);
  const device=devices.find(d=>d.id===r.deviceId||(d.aliases||[]).includes(r.deviceId));
  return {...r,deviceId:device?.id||r.deviceId,builder:summary(build),flashBuilder:summary(flash),
   device:device?{id:device.id,runnerId:device.runnerId,connected:!!device.connected,
    label:device.label||device.description||"USB device",transport:device.transport||"usb-serial"}:null,
   autoFlashEnabled:false,status:"configuration-only"};
 });
}
export function validateRouteRemoval(repository,organization,projects=[]){
 if(!namePattern.test(repository||"")||!repository.startsWith(organization+"/")||
  !projects.some(p=>p.fullName===repository))throw bad("Unknown repository route",404);
 return true;
}
