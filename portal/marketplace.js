"use strict";
const $=id=>document.getElementById(id);
let csrf=null,builders=[],releases=[],plans=[],selection=new Set(),current=null;
let placement="selected";
const esc=(tag,content,cls)=>{const el=document.createElement(tag);if(content!==undefined)el.textContent=String(content);if(cls)el.className=cls;return el;};
async function api(path,data){
 const headers={};if(data!==undefined){headers["content-type"]="application/json";headers["x-tt-csrf"]=csrf;}
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",method:data===undefined?"GET":"POST",
  headers,body:data===undefined?undefined:JSON.stringify(data)});
 const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||"HTTP "+r.status);return json;
}
function compatible(b,r){return !!b.managedHost&&r.targets.some(t=>t.os===b.os&&t.arch===b.arch);}
function familyGroups(){
 const q=$("marketplaceSearch").value.toLowerCase().trim();
 return [...new Set(releases.filter(r=>!q||[r.name,r.family,r.category,r.version].join(" ").toLowerCase().includes(q)).map(r=>r.family))];
}
function render(){
 const list=$("marketplaceFamilies");list.replaceChildren();
 for(const family of familyGroups()){
  const versions=releases.filter(x=>x.family===family);
  const box=esc("article",undefined,"tt-marketplace-tile");
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
  const row=esc("div",undefined,"tt-marketplace-version");
  const button=esc("button",release.version+" · "+release.targets.map(t=>t.os+"/"+t.arch).join(", "),"plain-button");
  button.type="button";button.addEventListener("click",()=>openRelease(release));row.append(button);list.append(row);
 }
 $("marketplaceDetail").hidden=false;$("marketplacePlan").hidden=true;
}
function openRelease(release){
 current=release;selection=new Set();placement="selected";
 $("marketplaceReleaseTitle").textContent=release.name+" "+release.version;
 $("placementSelected").checked=true;$("placementAll").checked=false;
 $("marketplacePlan").hidden=false;renderTargets();
}
function renderTargets(){
 const list=$("marketplaceTargets");list.replaceChildren();
 for(const builder of builders){
  const match=compatible(builder,current),row=esc("label",undefined,"tt-marketplace-target-row");
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
  const row=esc("div",undefined,"tt-marketplace-plan-row");
  row.append(esc("strong",plan.family+"@"+plan.version));
  row.append(esc("small",plan.targets.length+" builder(s) · "+plan.placement+" · Planned; not installed"));
  box.append(row);
 }
}
async function load(){
 try{
  const [overview,catalog,history]=await Promise.all([
   api("/api/local/overview"),api("/api/local/marketplace/releases"),api("/api/local/marketplace/plans")]);
  csrf=overview.csrf;builders=overview.runners.items||[];releases=catalog.releases||[];plans=history.plans||[];
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
  const result=await api("/api/local/marketplace/plan",input);
  $("marketplaceNotice").textContent="Plan "+result.plan.id+" saved for "+result.plan.targets.length+
   " builder(s). No software installed: validated recipes and Host Service update capabilities are still required.";
  plans.unshift(result.plan);renderPlans();
 }catch(e){$("marketplaceNotice").textContent=e.message;}finally{renderTargets();}
});
load();
