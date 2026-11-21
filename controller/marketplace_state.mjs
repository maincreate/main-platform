// One source of truth for the three Marketplace, Projects, and Builders views.
// A job completion is not an installed version: inventory must be reported by
// the enrolled Host Service. Never infer an SDK installation from compatibility.
import {releases,classifyBuilder} from "./marketplace_planning.mjs";
import {versionSatisfied} from "./project_monitor.mjs";

const packageNames={"arduino-cli":"arduino-cli","esp-idf":"esp-idf","android-sdk":"android-sdk","android-adb":"adb","nodejs":"node"};
const online=r=>!!r.lastSeen&&Date.now()-Date.parse(r.lastSeen)<120000&&!!r.managedHost;
const buildAdapters={"esp-idf":"firmware.esp_idf.build","arduino-cli":"firmware.arduino.build","nodejs":"web.static.build"};
export const validVersion=(observed,version)=>{
 if(typeof observed!=="string")return false;
 if(version==="system")return /^Android Debug Bridge version \d+\.\d+\.\d+$/.test(observed);
 // The Host Service reports canonical identities; arbitrary strings containing
 // a version number are not evidence that the expected SDK is installed.
 const found=/^(?:Arduino CLI |ESP-IDF v?|)(\d+\.\d+\.\d+)$/.exec(observed);
 return !!found&&found[1]===version;
};
export function verifiedInstall(host,release){
 const name=packageNames[release.family]||release.family;
 const pkg=(host.packages||[]).find(p=>p.name===name&&validVersion(p.version,release.version));
 return pkg?{state:"installed",evidence:"host-heartbeat",reported_version:pkg.version}:null;
}
export function projectReadiness(requirements,hosts){
 if(!requirements||!["declared","inferred"].includes(requirements.status)||!requirements.targets?.length)
  return {status:"unknown",ready:0,compatible:0,reason:"Project requirements not classified"};
 const releasesList=releases();const eligible=new Set(),ready=new Set();
 for(const t of requirements.targets){
  for(const host of hosts){
   if(!host.managedHost||host.decommission||host.os!==t.os||(t.arch&&host.arch!==t.arch))continue;
   if(!t.tools.every(tool=>!releasesList.some(r=>r.family===tool.name)||
       releasesList.some(r=>r.family===tool.name&&(!tool.version||versionSatisfied(r.version,tool.version))&&
       classifyBuilder(host,r,"install").compatible)))continue;
   eligible.add(host.id);
   if(!online(host)||!host.githubRunnerName||!host.fabricObservedAt||
      Date.now()-Date.parse(host.fabricObservedAt)>=120000)continue;
   if(!t.tools.every(tool=>{
    const versions=releasesList.filter(r=>r.family===tool.name&&(!tool.version||versionSatisfied(r.version,tool.version)));
    return versions.length?
      versions.some(v=>!!verifiedInstall(host,v)&&(!buildAdapters[tool.name]||
       (host.fabricCapabilities||[]).includes(buildAdapters[tool.name]))):
      (host.packages||[]).some(p=>p.name===tool.name&&versionSatisfied(p.version,tool.version));
   }))continue;
   // Don't show Ready when there is no known native execution capability for a project with no tool requirement.
   if(!t.tools.length||t.tools.every(tool=>!buildAdapters[tool.name]))continue;
   ready.add(host.id);
  }
 }
 return {status:ready.size?"ready":eligible.size?"setup_needed":"unavailable",
  ready:ready.size,compatible:eligible.size,
  reason:ready.size?"Verified toolchains and build executor available":
    eligible.size?"Compatible builders exist, but required installation or build executor is missing":"No compatible enrolled builder"};
}
export function marketplaceView(hosts,operations=[],jobs=[],projects=[]){
 const all=releases(),byId=new Map(jobs.map(j=>[j.id,j]));
 const software=[...new Set(all.map(r=>r.family))].map(family=>{
  const versions=all.filter(r=>r.family===family);
  const usage=projects.filter(p=>!p.archived&&!p.ignored&&
   p.requirements?.targets?.some(t=>t.tools?.some(tool=>tool.name===family))).length;
  return {id:family,name:versions[0].name,category:versions[0].category,
   version_count:versions.length,description:versions[0].description||null,
   recommended_for_projects:usage,installed_host_count:hosts.filter(h=>versions.some(r=>verifiedInstall(h,r))).length};
 });
 const operationRows=operations.slice(-40).reverse().map(op=>({
  id:op.id,family:op.family,version:op.version,created_at:op.createdAt,
  context:op.context||null,targets:(op.targets||[]).map(t=>{
   const host=hosts.find(h=>h.id===t.builderId),release=all.find(r=>r.family===op.family&&r.version===op.version);
   const job=byId.get(t.jobId);
   const installed=host&&release&&verifiedInstall(host,release);
   return {builder_id:t.builderId,hostname:t.hostname,job_id:t.jobId||null,
    state:installed?"installed":t.status==="already_installed"?"installed":t.status==="already_queued"?"queued":
     t.status==="failed"?"failed":job?.status==="completed"?"verifying":
     job?.status||t.status||"unknown",error:t.error||job?.error||null,
    logs:job?.status==="failed"?job.logs?.slice(-500)||null:null};
  })
 }));
 const hostRows=hosts.map(host=>({
  id:host.id,name:host.assignment?.displayName||host.name,os:host.os,arch:host.arch,
  online:online(host),fabric_ready:online(host)&&!!host.fabricObservedAt&&
   Date.now()-Date.parse(host.fabricObservedAt)<120000&&
   (host.fabricCapabilities||[]).length>0,
  capabilities:host.fabricCapabilities||[],
  installed:all.filter(r=>verifiedInstall(host,r)).map(r=>({family:r.family,version:r.version})),
  packages:(host.packages||[]).map(p=>({name:p.name,version:p.version}))
 }));
 return {software,releases:all,hosts:hostRows,operations:operationRows,
  projects:projects.slice(0,100).map(p=>({name:p.fullName,readiness:projectReadiness(p.requirements,hosts)}))};
}
