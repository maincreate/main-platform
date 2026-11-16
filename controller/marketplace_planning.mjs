// Marketplace compatibility is derived from the vendored Main{Create} Marketplace catalog.
// Installation plans are side-effect-free; a separate request dispatches an approved, pinned GitHub workflow.
import {readFileSync} from "node:fs";

const catalog=JSON.parse(readFileSync(new URL("../registry/toolkits.json",import.meta.url),"utf8"));
const bad=(message,status=422)=>Object.assign(new Error(message),{status});
const operations=["install","build","deploy","backup","restore"];
const normalizeTarget=t=>({os:t.os,arch:t.architecture,readiness:t.status,status:t.status,reason:t.reason||null,
  requiresConnectedDevice:t.requiresConnectedDevice===true});
const releaseList=Object.freeze(catalog.flatMap(toolkit=>(toolkit.versions||[]).map(version=>{
  const compatibility=version.compatibility||{};
  const targets=compatibility.install||[];
  const installers=version.installers||[];
  const installable=installers.length>0&&targets.some(t=>t.status==="supported")&&version.status!=="blocked";
  return {
    family:toolkit.id,name:toolkit.displayName,version:version.version,category:toolkit.category,
    id:toolkit.id+"@"+version.version,installable,source:version.releaseUrl||toolkit.publisher?.source||null,
    targets:targets.map(normalizeTarget),
    buildTargets:(compatibility.build||[]).map(normalizeTarget),
    deployTargets:(compatibility.deploy||[]).map(normalizeTarget),
    backupTargets:(compatibility.backup||[]).map(normalizeTarget),
    restoreTargets:(compatibility.restore||[]).map(normalizeTarget),
    installers,installer:version.installer||null,components:version.components||{},
    capabilities:toolkit.capabilities||[],operations:version.operations||{},
    lifecycle:version.lifecycle||{},deviceProfiles:version.deviceSupport?.targetProfiles||[],
    constraints:version.constraints||[],trust:toolkit.trust||{}
  };
})));

export function releases(){return releaseList.map(x=>({...x,
  targets:x.targets.map(t=>({...t})),buildTargets:x.buildTargets.map(t=>({...t})),
  deployTargets:x.deployTargets.map(t=>({...t})),backupTargets:x.backupTargets.map(t=>({...t})),
  restoreTargets:x.restoreTargets.map(t=>({...t})),installers:x.installers.map(i=>({...i}))
}));}

export function classifyBuilderForOperation(host,release,operation="install"){
 if(!host||!release)return {compatible:false,reason:"Builder or toolkit release is missing"};
 if(!operations.includes(operation))return {compatible:false,reason:"Unsupported toolkit operation"};
 const targets=operation==="install"?release.targets:release[operation+"Targets"];
 const variant=(targets||[]).find(t=>t.os===host.os&&t.arch===host.arch);
 if(!variant)return {compatible:false,reason:"Unsupported operating system or architecture for "+operation};
 if(variant.status!=="supported")return {compatible:false,reason:variant.reason||"Host compatibility has not been validated for "+operation};
 if(!host.managedHost||host.decommission)return {compatible:false,reason:"Builder is not an enrolled managed host"};
 if(!host.lastSeen||!Number.isFinite(Date.parse(host.lastSeen))||Date.now()-Date.parse(host.lastSeen)>120000)
  return {compatible:false,reason:"Builder heartbeat is stale or offline"};
 if(operation==="install"&&!release.installers.some(i=>i.os===host.os&&i.architecture===host.arch))
  return {compatible:false,reason:"No pinned installer exists for this host architecture"};
 return {compatible:true,readiness:variant.status,reason:operation+" compatibility is supported"};
}
export function classifyBuilder(host,release){return classifyBuilderForOperation(host,release,"install");}

export function makeInstallationPlan(input,builders,actor){
 if(!input||typeof input!=="object"||Array.isArray(input))throw bad("Invalid installation request");
 const release=releaseList.find(r=>r.family===input.family&&r.version===input.version);
 if(!release)throw bad("Choose a published marketplace release");
 if(!release.installable)throw bad("This toolkit version does not have a validated installer");
 if(release.family==="android-sdk"&&input.accept_android_sdk_license!==true)
  throw bad("Accept the Google Android SDK license before planning installation");
 if(!["selected","all-compatible"].includes(input.placement))throw bad("Choose selected builders or explicitly choose all compatible builders");
 const ids=input.builder_ids;
 if(input.placement==="selected"&&(!Array.isArray(ids)||!ids.length||ids.length>100||
  ids.some(id=>typeof id!=="string")||new Set(ids).size!==ids.length))throw bad("Select one or more unique builders");
 if(input.placement==="all-compatible"&&ids!==undefined&&(!Array.isArray(ids)||ids.length))
  throw bad("All compatible mode cannot specify individual builders");
 const eligible=builders.filter(h=>classifyBuilderForOperation(h,release,"install").compatible);
 const targets=input.placement==="selected"?ids.map(id=>{
  const host=builders.find(h=>h.id===id);if(!host)throw bad("Selected builder no longer exists",409);
  const result=classifyBuilderForOperation(host,release,"install");if(!result.compatible)throw bad(host.name+": "+result.reason,409);
  if(!host.githubRunnerName)throw bad(host.name+": GitHub Actions runner is not registered",409);
  return host;
 }):eligible.filter(h=>!!h.githubRunnerName);
 if(!targets.length)throw bad("No compatible, online managed GitHub builders are available",409);
 const recorded=targets.map(host=>{
  const match=classifyBuilderForOperation(host,release,"install");
  return {builderId:host.id,hostname:host.name,os:host.os,arch:host.arch,
   githubRunnerName:host.githubRunnerName,location:host.assignment?.location||"",
   assignedTo:host.assignment?.assignedTo||"",readiness:match.readiness,status:"awaiting_workflow_dispatch"};
 });
 return {id:crypto.randomUUID(),family:release.family,version:release.version,installable:true,
  placement:input.placement,targets:recorded,acceptAndroidSdkLicense:input.accept_android_sdk_license===true,
  createdBy:actor,createdAt:new Date().toISOString(),status:"planned",execution:"not_started",
  workflow:"maincreate-toolkit-install.yml",
  reason:"A version-pinned GitHub Actions installation workflow will run on each selected builder after explicit request. The workflow installs only the selected toolkit version and does not flash devices."};
}
export function validateAssignment(input){
 if(!input||typeof input!=="object")throw bad("Invalid builder metadata");
 const fields=["displayName","location","assignedTo","accessGroup"];
 const out={};for(const key of fields){
  const value=input[key];if(typeof value!=="string"||value.length>100||
   /[\x00-\x1f\x7f]/.test(value))throw bad("Invalid "+key);
  out[key]=value.trim();
 }
 return out;
}
