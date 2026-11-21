"use strict";
const $=id=>document.getElementById(id);
const qs=new URLSearchParams(location.search);
let csrf=null,store=null,view="browse",activeFamily=null,activeVersion=null,selection=new Set(),activeOperation=null,openedDeepLink=false,refreshing=false;
const el=(tag,value,cls)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value);if(cls)node.className=cls;return node;};
const p=(text)=>el("p",text,"mc-store-muted");
function notice(message){const node=$("marketplaceNotice");node.hidden=!message;node.textContent=message||"";}
async function api(path,payload){
 const headers={};if(payload!==undefined){headers["content-type"]="application/json";headers["x-maincreate-csrf"]=csrf;}
 const res=await fetch(path,{credentials:"same-origin",cache:"no-store",
  method:payload===undefined?"GET":"POST",headers,body:payload===undefined?undefined:JSON.stringify(payload)});
 if(res.status===401){location.assign("/setup");throw Error("Sign in required");}
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||"Request failed (HTTP "+res.status+")");
 return data;
}
const versionsFor=family=>(store?.releases||[]).filter(r=>r.family===family);
const byId=(family,version)=>versionsFor(family).find(r=>r.version===version);
const observed=(host,release)=>host.installed.some(item=>item.family===release.family&&item.version===release.version);
const adapterReady=(host,release)=>release.installable&&
 host.fabric_ready&&host.capabilities.includes(release.installCapabilityId||"");
function targetStatus(host,release){
 const match=release.targets.find(t=>t.os===host.os&&t.arch===host.arch);
 if(!match||match.status!=="supported")return {state:"incompatible",
  reason:match?.reason||"OS or architecture not supported"};
 if(observed(host,release))return {state:"installed",reason:"Version verified on this builder"};
 if(!host.online)return {state:"offline",reason:"Builder is offline"};
 if(!release.installable)return {state:"not_ready",reason:"No executable installer for this release yet"};
 if(!adapterReady(host,release))return {state:"not_ready",reason:"Builder does not advertise this installer"};
 return {state:"available",reason:"Compatible and ready to install"};
}
function button(text,cls,onClick){const b=el("button",text,cls);b.type="button";b.addEventListener("click",onClick);return b;}
function softwareTile(entry,compact=false){
 const card=el("article",undefined,compact?"mc-store-card mc-store-feature":"mc-store-card");
 const icon=el("div",({["esp-idf"]:"◈",["arduino-cli"]:"⌘",["android-sdk"]:"▣",["android-adb"]:"◉"}[entry.id]||"◇"),"mc-store-icon");
 const head=el("div",undefined,"mc-store-card-head");
 const body=el("div");body.append(el("strong",entry.name),el("small",entry.category||"Toolkit"));
 head.append(icon,body);card.append(head);
 const releases=versionsFor(entry.id);
 const meta=el("div",undefined,"mc-store-card-meta");
 meta.append(el("span",releases.length+" release"+(releases.length===1?"":"s")));
 if(entry.installed_host_count)meta.append(el("span","● "+entry.installed_host_count+" installed"));
 if(entry.recommended_for_projects)meta.append(el("span",entry.recommended_for_projects+" project"+(entry.recommended_for_projects===1?"":"s")));
 card.append(meta,button("View software","mc-store-card-action",()=>openFamily(entry.id)));
 return card;
}
function draw(){
 if(!store)return;
 const keyword=$("marketplaceSearch").value.toLowerCase().trim();
 $("marketplaceBrowse").classList.toggle("active",view==="browse");
 $("marketplaceInstalled").classList.toggle("active",view==="installed");
 $("marketplaceBrowse").setAttribute("aria-pressed",String(view==="browse"));
 $("marketplaceInstalled").setAttribute("aria-pressed",String(view==="installed"));
 $("marketplaceRecommendedSection").hidden=view!=="browse"||!!keyword;
 const recommended=store.software.filter(s=>s.recommended_for_projects>0)
  .sort((a,b)=>b.recommended_for_projects-a.recommended_for_projects);
 const top=recommended.length?recommended:store.software.filter(x=>["esp-idf","arduino-cli"].includes(x.id));
 $("marketplaceRecommendationInfo").textContent=recommended.length?
  "Based on detected software requirements in your projects":"Featured developer toolkits";
 $("marketplaceRecommended").replaceChildren(...top.slice(0,3).map(s=>softwareTile(s,true)));
 const matching=store.software.filter(s=>(view!=="installed"||s.installed_host_count>0)&&
  (!keyword||[s.name,s.id,s.category,...versionsFor(s.id).map(r=>r.version)].join(" ").toLowerCase().includes(keyword)));
 $("marketplaceBrowseTitle").textContent=view==="installed"?"Installed software":"Explore software";
 $("marketplaceFamilyCount").textContent=matching.length+" software famil"+(matching.length===1?"y":"ies");
 $("marketplaceFamilies").replaceChildren(...(matching.length?matching.map(s=>softwareTile(s)):
  [p(view==="installed"?"No verified software installations match this view.":"No matching software.")]));
 drawOperations();
}
function drawOperations(){
 const list=$("marketplaceOperations");if(!store)return;
 const operations=store.operations.slice(0,8);
 if(!operations.length){list.replaceChildren(p("No Marketplace installations requested yet."));return;}
 list.replaceChildren(...operations.map(op=>{
  const row=el("div",undefined,"mc-store-activity-row");
  const title=el("strong",op.family+" · "+op.version);
  const summary=op.targets.map(t=>t.hostname+": "+t.state.replaceAll("_"," ")).join("  ·  ");
  row.append(title,el("small",summary));
  const jobs=op.targets.filter(t=>t.job_id);
  if(jobs.length){const link=el("a","View jobs","mc-store-quiet-link");link.href="/jobs?job="+encodeURIComponent(jobs[0].job_id);row.append(link);}
  return row;
 }));
}
function openFamily(family,version=null){
 const entry=store.software.find(s=>s.id===family);
 if(!entry)return;
 activeFamily=family;
 const versions=versionsFor(family),wanted=version||qs.get("version");
 activeVersion=versions.find(r=>r.version===wanted)||versions[0]||null;
 $("marketplaceFamilyTitle").textContent=entry.name;
 $("marketplaceCategory").textContent=entry.category||"Software";
 $("marketplaceDescription").textContent=activeVersion?.description||"Choose a release and install it on compatible managed builders.";
 const chooser=$("marketplaceVersions");chooser.replaceChildren(...versions.map(r=>{
  const o=el("option",r.version+(r.channel?" · "+r.channel:""));o.value=r.version;return o;
 }));
 chooser.value=activeVersion?.version||"";
 updateDetail();
 $("marketplaceDetail").showModal();
}
function updateDetail(){
 const release=activeVersion;if(!release)return;
 const compatible=store.hosts.filter(h=>release.targets.some(t=>t.os===h.os&&t.arch===h.arch&&t.status==="supported"));
 const installed=store.hosts.filter(h=>observed(h,release));
 $("marketplaceLocations").textContent=installed.length+" of "+store.hosts.length+" builders";
 $("marketplaceCompatibility").textContent=compatible.length+" compatible builder"+(compatible.length===1?"":"s");
 $("marketplaceDetailBadge").textContent=release.installable?"Available for installation":"Catalog entry · installer not available";
 const note=$("marketplaceVersionNote");
 note.textContent=release.installable?
  installed.length?"Installed on "+installed.map(x=>x.name).join(", ")+". You can install it on additional compatible builders.":"No verified installations yet.":
  "This version is cataloged, but cannot be installed through Main{Create} yet. A verified installation adapter is required.";
 $("marketplaceManage").textContent=installed.length?"Manage installations":"Choose builders";
 $("marketplaceManage").disabled=!release.installable;
}
function openInstaller(){
 if(!activeVersion)return;
 selection.clear();activeOperation=null;
 $("marketplaceInstallTitle").textContent="Install "+activeVersion.name+" "+activeVersion.version;
 $("marketplaceInstallFeedback").textContent="";
 $("marketplaceInstallProgress").replaceChildren();
 renderTargets();
 $("marketplaceDetail").close();
 $("marketplaceInstaller").showModal();
}
function renderTargets(){
 const list=$("marketplaceTargets"),release=activeVersion;
 if(!release||!store)return;
 list.replaceChildren();
 let eligible=0;
 for(const host of store.hosts){
  const status=targetStatus(host,release);
  const row=el("label",undefined,"mc-store-target");
  const check=el("input");check.type="checkbox";check.value=host.id;
  check.disabled=status.state!=="available";check.checked=selection.has(host.id)&&!check.disabled;
  if(check.checked)eligible++;
  check.addEventListener("change",()=>{check.checked?selection.add(host.id):selection.delete(host.id);renderTargets();});
  const name=el("div",undefined,"mc-store-target-name");
  name.append(el("strong",host.name),el("small",host.os+" / "+host.arch+" · "+status.reason));
  row.append(check,name,el("span",status.state.replaceAll("_"," "),"mc-store-target-state"));
  list.append(row);
 }
 $("marketplaceTargetCount").textContent=eligible+" builder"+(eligible===1?"":"s")+" selected";
 $("marketplaceSubmit").disabled=!eligible;
 $("marketplaceSubmit").textContent="Install on "+eligible+" builder"+(eligible===1?"":"s");
}
function renderProgress(){
 if(!activeOperation)return;
 const op=store.operations.find(o=>o.id===activeOperation);
 if(!op)return;
 const wrap=$("marketplaceInstallProgress");wrap.replaceChildren();
 for(const t of op.targets){
  const row=el("div",undefined,"mc-store-activity-row");
  row.append(el("strong",t.hostname),el("small",t.state.replaceAll("_"," ")+(t.error?" · "+t.error:"")));
  if(t.job_id){const link=el("a","Inspect job","mc-store-quiet-link");link.href="/jobs?job="+encodeURIComponent(t.job_id);row.append(link);}
  wrap.append(row);
 }
}
async function load(){
 if(refreshing)return;refreshing=true;
 try{
  if(!csrf){const ov=await api("/api/local/overview");csrf=ov.csrf;}
  store=await api("/api/local/marketplace/state");
  draw();
  if(activeVersion){
   activeVersion=byId(activeVersion.family,activeVersion.version);
   if($("marketplaceDetail").open)updateDetail();
   if($("marketplaceInstaller").open){renderTargets();renderProgress();}
  }
  if(!openedDeepLink){
   openedDeepLink=true;const family=qs.get("software");
   if(family&&store.software.some(x=>x.id===family)){
    openFamily(family,qs.get("version"));
    const hostId=qs.get("builder");
    if(hostId&&activeVersion?.installable){
     openInstaller();if(store.hosts.some(h=>h.id===hostId&&targetStatus(h,activeVersion).state==="available"))selection.add(hostId);
     renderTargets();
    }
   }
  }
  notice("");
 }catch(e){notice(e.message);}finally{refreshing=false;}
}
$("marketplaceBrowse").addEventListener("click",()=>{view="browse";draw();});
$("marketplaceInstalled").addEventListener("click",()=>{view="installed";draw();});
$("marketplaceSearch").addEventListener("input",draw);
$("marketplaceVersions").addEventListener("change",e=>{activeVersion=byId(activeFamily,e.target.value);updateDetail();});
$("marketplaceClose").addEventListener("click",()=>$("marketplaceDetail").close());
$("marketplaceDetailCancel").addEventListener("click",()=>$("marketplaceDetail").close());
$("marketplaceManage").addEventListener("click",openInstaller);
$("marketplaceInstallClose").addEventListener("click",()=>$("marketplaceInstaller").close());
$("marketplaceInstallCancel").addEventListener("click",()=>$("marketplaceInstaller").close());
$("marketplaceSubmit").addEventListener("click",async()=>{
 const targets=[...selection],release=activeVersion;if(!targets.length||!release)return;
 const button=$("marketplaceSubmit");button.disabled=true;
 try{
  const payload={request_id:crypto.randomUUID(),family:release.family,version:release.version,builder_ids:targets};
  if(qs.get("project"))payload.project=qs.get("project");
  const result=await api("/api/local/marketplace/install",payload);
  activeOperation=result.operation.id;selection.clear();
  $("marketplaceInstallFeedback").textContent=result.partial?
   "Some builders could not be scheduled. See details below.":"Installation request recorded. Results will be verified against builder inventory.";
  await load();renderProgress();
 }catch(e){$("marketplaceInstallFeedback").textContent=e.message;}finally{renderTargets();}
});
load();
setInterval(()=>{if(!document.hidden)load();},8000);
