"use strict";
const $=id=>document.getElementById(id);
let csrf=null,builders=[],releases=[],plans=[],selection=new Set(),current=null;
let placement="selected";
const esc=(tag,content,cls)=>{const el=document.createElement(tag);if(content!==undefined)el.textContent=String(content);if(cls)el.className=cls;return el;};
async function api(path,data){
 const headers={};if(data!==undefined){headers["content-type"]="application/json";headers["x-maincreate-csrf"]=csrf;}
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",method:data===undefined?"GET":"POST",
  headers,body:data===undefined?undefined:JSON.stringify(data)});
 const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||"HTTP "+r.status);return json;
}
let microcontrollers=[];
function renderMicrocontrollers(){
 const target=$("mcuCatalog");target.replaceChildren();
 const search=$("mcuSearch").value.toLowerCase().trim();
 for(const family of microcontrollers.filter(f=>!search||[f.name,...f.chips,
  ...f.sdk.flatMap(s=>[s.id,...s.versions])].join(" ").toLowerCase().includes(search))){
  const card=esc("article",undefined,"maincreate-marketplace-tile");
  card.append(esc("h3",family.name),esc("small",family.chips.join(" · ")));
  const list=esc("div",undefined,"maincreate-mcu-marketplace-sdks");
  for(const sdk of family.sdk){
   const row=esc("p");row.append(esc("strong",sdk.id+" "));
   row.append(esc("span",sdk.versions.length?sdk.versions.join(", "):"Version selection pending"));
   row.append(esc("small"," · "+sdk.status));
   list.append(row);
  }
  card.append(list,esc("p","Read-only reference · no automatic installation"));
  target.append(card);
 }
 if(!target.children.length)target.append(esc("p","No matching microcontrollers or SDKs."));
}
$("mcuSearch").addEventListener("input",renderMicrocontrollers);
function compatible(b,r){return !!r?.installable&&!!b.managedHost&&!b.decommission&&!!b.githubRunnerName&&!!b.lastSeen&&Date.now()-Date.parse(b.lastSeen)<120000&&r.targets.some(t=>t.os===b.os&&t.arch===b.arch&&t.status==="supported");}
function familyGroups(){
 const q=$("marketplaceSearch").value.toLowerCase().trim();
 return [...new Set(releases.filter(r=>!q||[r.name,r.family,r.category,r.version].join(" ").toLowerCase().includes(q)).map(r=>r.family))];
}
function render(){
 const list=$("marketplaceFamilies");list.replaceChildren();
 for(const family of familyGroups()){
  const versions=releases.filter(x=>x.family===family);
  const box=esc("article",undefined,"maincreate-marketplace-tile");
  const title=esc("h3",versions[0].name);box.append(title,esc("p",versions[0].category));
  box.append(esc("small",versions.length+" selectable release"+(versions.length===1?"":"s")));
  const choose=esc("button","View versions","plain-button");
  choose.type="button";choose.addEventListener("click",()=>openFamily(family));box.append(choose);list.append(box);
 }
 if(!list.children.length)list.textContent="No matching marketplace families.";
}
function openFamily(family){
 current=null;const versions=releases.filter(x=>x.family===family);
 $("marketplaceFamilyTitle").textContent=versions[0]?.name||family;
 const list=$("marketplaceVersions");list.replaceChildren();
 for(const release of versions){
  const row=esc("div",undefined,"maincreate-marketplace-version");
  const button=esc("button",release.version+" · "+release.targets.map(t=>t.os+"/"+t.arch).join(", "),"plain-button");
  button.type="button";button.addEventListener("click",()=>openRelease(release));row.append(button);list.append(row);
 }
 $("marketplaceDetail").hidden=false;$("marketplacePlan").hidden=true;
}
function openRelease(release){
 current=release;selection=new Set();placement="selected";
 $("marketplaceReleaseTitle").textContent=release.name+" "+release.version;
 $("placementSelected").checked=true;$("placementAll").checked=false;
 $("marketplacePlan").hidden=false;$("androidLicenseRow").hidden=release.family!=="android-sdk";$("androidLicense").checked=false;renderTargets();
}
function renderTargets(){
 const list=$("marketplaceTargets");list.replaceChildren();
 for(const builder of builders){
  const match=compatible(builder,current),row=esc("label",undefined,"maincreate-marketplace-target-row");
  const check=document.createElement("input");check.type="checkbox";check.disabled=!match||placement==="all-compatible";
  check.checked=placement==="all-compatible"?match:selection.has(builder.id);
  check.addEventListener("change",()=>{if(check.checked)selection.add(builder.id);else selection.delete(builder.id);renderTargets();});
  row.append(check);
  const meta=esc("span");meta.append(esc("strong",builder.assignment?.displayName||builder.name));
  meta.append(esc("small",(builder.assignment?.location||"Location not set")+" · "+
    (builder.assignment?.assignedTo||"Unassigned")+" · "+builder.os+"/"+builder.arch+
    (match?"":" · Incompatible or unmanaged")));
  row.append(meta);list.append(row);
 }
 const count=placement==="all-compatible"?builders.filter(b=>compatible(b,current)).length:selection.size;
 $("marketplaceTargetCount").textContent=count+" builder"+(count===1?"":"s")+" targeted";
 $("marketplaceSubmit").disabled=!count;
}
function renderPlans(){
 const box=$("marketplacePlans");box.replaceChildren();
 if(!plans.length){box.textContent="No installation plans yet.";return;}
 for(const plan of plans.slice(0,10)){
  const row=esc("article",undefined,"maincreate-marketplace-plan-row");
  row.append(esc("strong",plan.family+"@"+plan.version));
  row.append(esc("small",plan.targets.length+" builder(s) · "+plan.placement+" · "+(plan.execution||"planned")));
  for(const target of plan.targets||[]){
   const item=esc("div",undefined,"maincreate-marketplace-target-row");
   const meta=esc("span");meta.append(esc("strong",target.hostname||target.builderId));
   meta.append(esc("small",(target.os||"")+" / "+(target.arch||"")+" · "+(target.status||"pending")));
   item.append(meta);
   if(target.workflowRunUrl){
    const link=esc("a","Open GitHub Actions run");link.href=target.workflowRunUrl;link.target="_blank";link.rel="noopener noreferrer";item.append(link);
   }
   if(target.error)item.append(esc("small",target.error));
   if(target.labelError)item.append(esc("small","Toolkit installed, but runner label sync failed: "+target.labelError));
   if(target.cleanupStatus)item.append(esc("small","Cleanup: "+target.cleanupStatus));
   if(target.status==="completed"&&target.labelsRegistered){
    const cleanup=esc("button","Remove this version","plain-button");cleanup.type="button";
    cleanup.addEventListener("click",async()=>{
     if(!confirm("Remove "+plan.family+" "+plan.version+" from "+(target.hostname||target.builderId)+"? The workflow removes only this toolkit version and preserves project data and backups."))return;
     cleanup.disabled=true;
     try{
      const result=await api("/api/local/marketplace/cleanup",{plan_id:plan.id,builder_id:target.builderId,confirm_cleanup:true});
      $("marketplaceNotice").textContent="Cleanup dispatched. The runner label will be removed after the workflow succeeds.";
      target.cleanupStatus="dispatched";target.cleanupId=result.cleanup.cleanupId;await load();
setInterval(()=>{if(!document.hidden)load();},10000);
     }catch(e){$("marketplaceNotice").textContent=e.message;cleanup.disabled=false;}
    });
    item.append(cleanup);
   }
   row.append(item);
  }
  box.append(row);
 }
 const cleanups=historyCleanups;
}
async function load(){
 try{
  const [overview,catalog,history,mcu]=await Promise.all([
   api("/api/local/overview"),api("/api/local/marketplace/releases"),api("/api/local/marketplace/plans"),api("/api/local/microcontrollers")]);
  csrf=overview.csrf;builders=overview.runners.items||[];releases=catalog.releases||[];plans=history.plans||[];
  microcontrollers=mcu.families||[];renderMicrocontrollers();
  render();renderPlans();
 }catch(e){$("marketplaceNotice").textContent=e.message;}
}
$("marketplaceSearch").addEventListener("input",render);
for(const [id,value] of [["placementSelected","selected"],["placementAll","all-compatible"]])
 $(id).addEventListener("change",()=>{placement=value;renderTargets();});
$("marketplaceClose").addEventListener("click",()=>{$("marketplaceDetail").hidden=true;});
$("marketplaceSubmit").addEventListener("click",async()=>{
 if(!current)return;
 const button=$("marketplaceSubmit");button.disabled=true;
 try{
  const input={family:current.family,version:current.version,placement};
  if(placement==="selected")input.builder_ids=[...selection];
  if(current.family==="android-sdk")input.accept_android_sdk_license=$("androidLicense").checked;
  const result=await api("/api/local/marketplace/plan",input);
  $("marketplaceNotice").textContent="Plan "+result.plan.id+" saved. Installation has not started yet.";
  $("marketplaceRequest").hidden=!result.plan.installable;
  plans.unshift(result.plan);renderPlans();
 }catch(e){$("marketplaceNotice").textContent=e.message;}finally{renderTargets();}
});
$("marketplaceRequest").addEventListener("click",async()=>{
 const button=$("marketplaceRequest");const plan=plans[0];if(!plan)return;
 if(!confirm("Install "+plan.family+" "+plan.version+" on "+plan.targets.length+" selected builder(s)? This changes the selected machines but does not flash any devices."))return;
 button.disabled=true;
 try{const result=await api("/api/local/marketplace/request",{plan_id:plan.id});$("marketplaceNotice").textContent=result.partial?"Some installation workflows could not be dispatched; inspect each builder status.":"Version-pinned installation workflows dispatched to the selected builders.";plans[0]=result.plan;await load();}
 catch(e){$("marketplaceNotice").textContent=e.message;}finally{button.disabled=false;}
});
load();
