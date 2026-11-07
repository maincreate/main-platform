"use strict";
const $=id=>document.getElementById(id);
let csrf=null;
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
 for(const project of result.repositories){
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
