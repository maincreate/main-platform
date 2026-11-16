// Marketplace catalog is the source of truth for toolkit versions and host compatibility.
import {readFileSync} from "node:fs";

const toolkitCatalog=JSON.parse(readFileSync(new URL("../registry/toolkits.json",import.meta.url),"utf8"));
if(!Array.isArray(toolkitCatalog))throw new Error("Invalid marketplace toolkit catalog");

const releaseList=Object.freeze(toolkitCatalog.flatMap(toolkit=>(toolkit.versions||[]).map(version=>{
 const install=version.lifecycle?.install||{};
 return {
  id:toolkit.id+"@"+version.version,
  family:toolkit.id,
  name:toolkit.displayName,
  version:version.version,
  channel:version.channel||"stable",
  category:toolkit.category,
  state:version.status||toolkit.state,
  toolkitState:toolkit.state,
  installable:install.state==="available"&&typeof install.capabilityId==="string",
  installState:install.state||"unsupported",
  installCapabilityId:install.capabilityId||null,
  source:version.installer?.source||version.installers?.[0]?.source||null,
  targets:(version.compatibility?.install||[]).map(target=>({
   os:target.os,arch:target.architecture,status:target.status,readiness:target.status,reason:target.reason||null
  })),
  compatibility:version.compatibility||{},
  lifecycle:version.lifecycle||{},
  operations:version.operations||{},
  capabilities:toolkit.capabilities||[],
  deviceSupport:version.deviceSupport||{}
 };
})));

const bad=(message,status=422)=>Object.assign(new Error(message),{status});
export function releases(){return releaseList.map(x=>({...x,targets:x.targets.map(t=>({...t}))}));}

export function classifyBuilder(host,release,operation="install"){
 const variants=release.compatibility?.[operation]||(
  operation==="install"?release.targets:[]
 );
 const variant=variants.find(t=>t.os===host.os&&(t.architecture||t.arch)===host.arch);
 if(!variant)return {compatible:false,reason:"Unsupported operating system or architecture"};
 if(!host.managedHost)return {compatible:false,reason:"Builder is not controller-managed"};
 if(variant.status!=="supported"){
  return {compatible:false,readiness:variant.status,
   reason:variant.reason||"This OS/architecture combination requires validation before it can be enabled"};
 }
 const readiness=release.lifecycle?.[operation]?.state||"supported";
 return {compatible:true,readiness,
  reason:readiness==="pilot"?"Pilot profile; operation requires validation and explicit approval":
   readiness==="available"?"Validated marketplace operation":"Compatibility verified; operation implementation may still be unavailable"};
}

export function makeInstallationPlan(input,builders,actor){
 if(!input||typeof input!=="object")throw bad("Invalid installation request");
 const release=releaseList.find(r=>r.family===input.family&&r.version===input.version);
 if(!release)throw bad("Choose a published marketplace release");
 if(!["selected","all-compatible"].includes(input.placement))throw bad("Choose selected builders or explicitly choose all compatible builders");
 const ids=input.builder_ids;
 if(input.placement==="selected"&&(!Array.isArray(ids)||!ids.length||ids.length>100||
  ids.some(id=>typeof id!=="string")||new Set(ids).size!==ids.length))throw bad("Select one or more unique builders");
 if(input.placement==="all-compatible"&&ids!==undefined&&(!Array.isArray(ids)||ids.length))
  throw bad("All compatible mode cannot specify individual builders");
 const eligible=builders.filter(h=>classifyBuilder(h,release,"install").compatible);
 const targets=input.placement==="selected"?ids.map(id=>{
  const host=builders.find(h=>h.id===id);if(!host)throw bad("Selected builder no longer exists",409);
  const result=classifyBuilder(host,release,"install");if(!result.compatible)throw bad(host.name+": "+result.reason,409);
  return host;
 }):eligible;
 if(!targets.length)throw bad("No compatible managed builders are available",409);
 const recorded=targets.map(host=>{
  const match=classifyBuilder(host,release,"install");
  return {builderId:host.id,hostname:host.name,location:host.assignment?.location||"",
   assignedTo:host.assignment?.assignedTo||"",readiness:match.readiness,
   status:release.installable?"awaiting_approval":"awaiting_validated_installer"};
 });
 return {
  id:crypto.randomUUID(),family:release.family,version:release.version,
  installable:release.installable,installCapabilityId:release.installCapabilityId,
  installState:release.installState,placement:input.placement,targets:recorded,
  createdBy:actor,createdAt:new Date().toISOString(),status:"planned",execution:"not_started",
  reason:release.installable
   ?"A reviewed, available installation capability is registered. Execution still requires a separate approved fabric job and runner opt-in; no host changes made."
   :"This version is cataloged for this host, but its installation capability is not yet enabled. No host changes made."
 };
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
