// Versioned marketplace catalog and bounded fleet placement plans.
// A plan is not an installation. Execution requires separate validated recipes and host capability negotiation.
const releaseList=Object.freeze([
 {family:'esp-idf',name:'ESP-IDF',version:'5.5.6',category:'Embedded SDK',targets:[{os:'linux',arch:'arm64',readiness:'pilot'},{os:'linux',arch:'x64',readiness:'review'},{os:'windows',arch:'x64',readiness:'review'},{os:'macos',arch:'arm64',readiness:'review'}]},
 {family:'lvgl',name:'LVGL',version:'9.x',category:'UI Framework',targets:[{os:'linux',arch:'arm64',readiness:'review'},{os:'macos',arch:'arm64',readiness:'review'},{os:'windows',arch:'x64',readiness:'review'}]},
 {family:'swift',name:'Swift Toolchain',version:'6.1.2',category:'Application SDK',targets:[{os:'macos',arch:'arm64',readiness:'pilot'},{os:'linux',arch:'x64',readiness:'review'},{os:'windows',arch:'x64',readiness:'review'}]}
]);
const bad=(message,status=422)=>Object.assign(new Error(message),{status});
export function releases(){return releaseList.map(x=>({...x,id:x.family+'@'+x.version}));}
export function classifyBuilder(host,release){
 const variant=release.targets.find(t=>t.os===host.os&&t.arch===host.arch);
 if(!variant)return {compatible:false,reason:'Unsupported operating system or architecture'};
 if(!host.managedHost)return {compatible:false,reason:'Builder is not controller-managed'};
 return {compatible:true,readiness:variant.readiness,
  reason:variant.readiness==='pilot'?'Pilot profile; installer validation still required':'Compatibility profile under review'};
}
export function makeInstallationPlan(input,builders,actor){
 if(!input||typeof input!=='object')throw bad('Invalid installation request');
 const release=releaseList.find(r=>r.family===input.family&&r.version===input.version);
 if(!release)throw bad('Choose a published marketplace release');
 if(!['selected','all-compatible'].includes(input.placement))throw bad('Choose selected builders or explicitly choose all compatible builders');
 const ids=input.builder_ids;
 if(input.placement==='selected'&&(!Array.isArray(ids)||!ids.length||ids.length>100||
  ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length))throw bad('Select one or more unique builders');
 if(input.placement==='all-compatible'&&ids!==undefined&&(!Array.isArray(ids)||ids.length))
  throw bad('All compatible mode cannot specify individual builders');
 const eligible=builders.filter(h=>classifyBuilder(h,release).compatible);
 const targets=input.placement==='selected'?ids.map(id=>{
  const host=builders.find(h=>h.id===id);if(!host)throw bad('Selected builder no longer exists',409);
  const result=classifyBuilder(host,release);if(!result.compatible)throw bad(host.name+': '+result.reason,409);
  return host;
 }):eligible;
 if(!targets.length)throw bad('No compatible managed builders are available',409);
 const recorded=targets.map(host=>{
  const match=classifyBuilder(host,release);
  return {builderId:host.id,hostname:host.name,location:host.assignment?.location||'',
   assignedTo:host.assignment?.assignedTo||'',readiness:match.readiness,
   status:'awaiting_validated_installer'};
 });
 return {id:crypto.randomUUID(),family:release.family,version:release.version,
  placement:input.placement,targets:recorded,createdBy:actor,createdAt:new Date().toISOString(),
  status:'planned',execution:'not_started',
  reason:'No approved immutable installer recipe and host upgrade mechanism are available for this release. No host changes made.'};
}
export function validateAssignment(input){
 if(!input||typeof input!=='object')throw bad('Invalid builder metadata');
 const fields=['displayName','location','assignedTo','accessGroup'];
 const out={};for(const key of fields){
  const value=input[key];if(typeof value!=='string'||value.length>100||
   /[\x00-\x1f\x7f]/.test(value))throw bad('Invalid '+key);
  out[key]=value.trim();
 }
 return out;
}
