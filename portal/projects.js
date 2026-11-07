"use strict";
const $=id=>document.getElementById(id);
let csrf=null,selectedOrg=null,projectInventory=[],projectUpdatedAt=null,projectTruncated=false;
try{const t=localStorage.getItem("tt-theme");if(["midnight","paper","graphite"].includes(t))document.body.dataset.theme=t;}catch{}
async function api(path,payload){
 const options={credentials:"same-origin",cache:"no-store"};
 if(payload!==undefined){options.method="POST";options.headers={"content-type":"application/json","x-tt-csrf":csrf};options.body=JSON.stringify(payload);}
 const response=await fetch(path,options);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"GitHub repository synchronization failed");
 return data;
}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function render(result){
 projectInventory=result.repositories||[];projectUpdatedAt=result.updatedAt;projectTruncated=!!result.truncated;
 renderProjectList();
}
function renderProjectList(){
 const result={repositories:projectInventory,organization:selectedOrg,updatedAt:projectUpdatedAt,truncated:projectTruncated};
 $("organization").textContent=result.organization?result.organization+" repositories":"GitHub repositories";
 $("syncStatus").textContent=result.updatedAt?
  "Last synchronized "+new Date(result.updatedAt).toLocaleString()+(result.truncated?" · first 500 repositories only":""):
  result.organization?"Not synchronized yet. Sync to retrieve your installed repositories.":"Connect an organization in Settings first.";
 const holder=$("projectRows");holder.replaceChildren();
 if(!result.repositories?.length){
  const empty=node("div",result.organization?"No repositories in the current inventory.":"GitHub organization not connected.","home-empty");
  const link=node("a",result.organization?"Sync GitHub repositories":"Open connection settings","quiet-link");
  link.href=result.organization?"/projects":"/settings";empty.append(link);holder.append(empty);return;
 }
 const query=$("projectSearch").value.toLowerCase().trim(),filter=$("projectFilter").value;
 const items=result.repositories.filter(item=>(!query||[item.fullName,item.description,item.defaultBranch].join(" ").toLowerCase().includes(query))&&
  (filter==="all"||(filter==="active"&&!item.archived)||(filter==="archived"&&item.archived)||(filter==="private"&&item.private)||(filter==="public"&&!item.private)));
 if(!items.length){holder.append(node("p","No matching repositories.","home-empty"));return;}
 for(const project of items){
  const card=node("article",undefined,"project-entry"),left=node("div"),right=node("div",undefined,"project-right");
  const name=node("strong",project.fullName),description=node("small",project.description||"Default: "+(project.defaultBranch||"unknown"));
  left.append(name,description);
  const details=node("small",project.builds+" local build job"+(project.builds===1?"":"s")+
   (project.latestBuild?" · Last: "+project.latestBuild.status.replaceAll("_"," "):""));
  right.append(details);
  const link=node("a","View on GitHub");
  link.href=project.url;link.target="_blank";link.rel="noopener noreferrer";
  right.append(link);card.append(left,right);holder.append(card);
 }
}
async function load(){
 try{
  if(!csrf){const overview=await api("/api/local/overview");csrf=overview.csrf;$("username").textContent=overview.username||"administrator";}
  const projects=await api("/api/local/projects");
  selectedOrg=projects.organization;
  $("newRepo").disabled=!selectedOrg;
  $("sync").disabled=!projects.organization;
  render(projects);
  $("notice").textContent="";
 }catch(e){$("notice").textContent=e.message;}
}
$("sync").addEventListener("click",async()=>{
 $("sync").disabled=true;$("notice").textContent="Synchronizing permitted repository metadata…";
 try{await api("/api/local/projects/sync",{});await load();}
 catch(e){$("notice").textContent=e.message;}
 finally{$("sync").disabled=false;}
});
load();

$("newRepo").addEventListener("click",async()=>{
 if(!selectedOrg){$("notice").textContent="Connect a GitHub organization first.";return;}
 try{
  const defaults=await api("/api/local/github/repository/preferences");
  $("newRepoOrg").textContent=selectedOrg;
  $("newRepoVisibility").value=defaults.defaultVisibility||"private";
  $("newRepoNotice").textContent="";
  $("newRepoForm").reset();
  $("newRepoVisibility").value=defaults.defaultVisibility||"private";
  $("newRepoDialog").showModal();
 }catch(e){$("notice").textContent=e.message;}
});
$("cancelRepo").addEventListener("click",()=>$("newRepoDialog").close());
$("newRepoForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const name=$("newRepoName").value.trim(),visibility=$("newRepoVisibility").value;
 const description=$("newRepoDescription").value.trim(),org=selectedOrg;
 if(!confirm("Create "+org+"/"+name+" as a "+visibility+" GitHub repository?"))return;
 const button=$("createRepo");button.disabled=true;
 try{
  const result=await api("/api/local/github/repository/create",{organization:org,name,description,visibility});
  $("newRepoDialog").close();
  $("notice").textContent="Created "+result.repository.fullName+". Synchronizing repository inventory…";
  try{await api("/api/local/projects/sync",{});await load();$("notice").textContent="Created "+result.repository.fullName+".";}
  catch{await load();$("notice").textContent="Created "+result.repository.fullName+". Repository inventory synchronization may need a manual refresh.";}
 }catch(e){$("newRepoNotice").textContent=e.message;}
 finally{button.disabled=false;}
});
 
$("projectSearch").addEventListener("input",renderProjectList);
$("projectFilter").addEventListener("change",renderProjectList);
