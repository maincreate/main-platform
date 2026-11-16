// Marketplace planning is generated from the pinned, vendored marketplace catalog.
// A plan is not an installation; execution is a separate approved Fabric job.
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";

const catalog=JSON.parse(readFileSync(new URL("../registry/toolkits.json",import.meta.url),"utf8"));
const bad=(message,status=422)=>Object.assign(new Error(message),{status});
const INSTALL_CAPABILITIES=Object.freeze({
 "espressif.esp-idf.install":"sdk.esp_idf.install",
 "android.sdk.install":"sdk.android.install",
 "android.adb.install-debian":"sdk.android_adb.install",
 "arduino-cli.install":"sdk.arduino_cli.install"
});
const ACTIVE_STATES=new Set(["pilot","available"]);
const cleanTarget=t=>({os:t.os,arch:t.architecture,readiness:t.status==="supported"?"validated":t.status,
 status:t.status,requiresConnectedDevice:!!t.requiresConnectedDevice});
function toRelease(toolkit,version){
 const lifecycle=version.lifecycle||{};
 const install=lifecycle.install||{};
 const installCapability=INSTALL_CAPABILITIES[install.recipeId]||null;
 const installTargets=(version.compatibility?.install||[]).filter(t=>t.status==="supported").map(cleanTarget);
 const buildTargets=(version.compatibility?.build||[]).filter(t=>t.status==="supported").map(cleanTarget);
 const installable=ACTIVE_STATES.has(install.state)&&!!install.recipeId&&!!installCapability&&installTargets.length>0;
 return {
  id:toolkit.id+"@"+version.version,family:toolkit.id,toolkitId:toolkit.id,
  name:toolkit.displayName,version:version.version,channel:version.channel,
  category:toolkit.category,description:toolkit.description||"",
  state:version.status,toolkitState:toolkit.state,
  installable,installCapability,installRecipeId:install.recipeId||null,
  buildable:ACTIVE_STATES.has(lifecycle.build?.state)||lifecycle.build?.state==="partial",
  reviewOnly:!ACTIVE_STATES.has(version.status)||!installable,
  targets:installTargets,buildTargets,
  compatibility:version.compatibility||{},
  capabilities:toolkit.capabilities||[],
  operations:version.operations||{},
  lifecycle,
  installers:version.installers||[],
  deviceSupport:version.deviceSupport||{},
  constraints:version.constraints||[]
 };
}
const releaseList=catalog.flatMap(toolkit=>(toolkit.versions||[]).map(version=>toRelease(toolkit,version)));
export function releases(){return releaseList.map(x=>({...x,targets:x.targets.map(t=>({...t})),buildTargets:x.buildTargets.map(t=>({...t}))}));}
export function findRelease(family,version){return releaseList.find(r=>r.family===family&&r.version===version)||null;}
export function classifyBuilder(host,release,operation="install"){
 const variants=(release.compatibility?.[operation]||release.targets||[]);
 const variant=variants.find(t=>t.os===host.os&&t.architecture===host.arch||t.os===host.os&&t.arch===host.arch);
 if(!variant||variant.status!=="supported")return {compatible:false,reason:"Unsupported or unvalidated operating system/architecture for "+operation};
 if(!host.managedHost)return {compatible:false,reason:"Builder is not controller-managed"};
 if(operation==="install"&&!release.installable)return {compatible:false,reason:"No reviewed installer is enabled for this toolkit version"};
 return {compatible:true,readiness:release.state==="pilot"?"pilot":"validated",
  reason:release.state==="pilot"?"Pilot release; operation remains subject to adapter validation":"Validated compatibility profile"};
}
export function makeInstallationPlan(input,builders,actor){
 if(!input||typeof input!=="object")throw bad("Invalid installation request");
 const release=findRelease(input.family,input.version);
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
   status:release.installable?"ready_for_approval":"awaiting_validated_installer"};
 });
 return {id:randomUUID(),family:release.family,toolkitId:release.toolkitId,version:release.version,
  installable:release.installable,installCapability:release.installCapability,
  installRecipeId:release.installRecipeId,placement:input.placement,operation:"install",
  targets:recorded,createdBy:actor,createdAt:new Date().toISOString(),
  status:"planned",execution:"not_started",
  reason:release.installable?"Versioned installer recipe selected. Each target receives a separate approval-gated Fabric job; no host changes have been made.":
   "Catalog-only or unsupported lifecycle stage; no installer is enabled. No host changes made."};
}
export function validateAssignment(input){
 if(!input||typeof input!=="object")throw bad("Invalid builder metadata");
 const fields=["displayName","location","assignedTo","accessGroup"];
 const out={};for(const key of fields){
  const value=input[key];if(typeof value!=="string"||value.length>100||/[\x00-\x1f\x7f]/.test(value))throw bad("Invalid "+key);
  out[key]=value.trim();
 }
 return out;
}
