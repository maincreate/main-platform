"use strict";
const $=id=>document.getElementById(id);
try{const theme=localStorage.getItem("tt-theme");if(["midnight","graphite","paper"].includes(theme))document.body.dataset.theme=theme;}catch{}
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
async function api(path){
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store"});
 if(response.status===401){location.replace("/setup");throw new Error("Sign in required");}
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(value.error||"Unable to fetch "+path);
 return value;
}
function statusText(node,text){$(node).textContent=text;}
function relative(date){
 if(!date)return "Never";
 const ms=Date.now()-Date.parse(date);
 if(!Number.isFinite(ms))return "Unknown";
 if(ms<60000)return "Just now";
 if(ms<3600000)return Math.floor(ms/60000)+"m ago";
 if(ms<86400000)return Math.floor(ms/3600000)+"h ago";
 return new Date(date).toLocaleDateString();
}
function row(parent,title,subtitle,detail){
 const e=element("div",undefined,"list-row"),main=element("div"),name=element("strong",title),
 meta=element("small",subtitle),side=element("span",detail||"","row-detail");
 main.append(name,meta);e.append(main,side);parent.append(e);return e;
}
function empty(parent,heading,description,href,label){
 parent.replaceChildren();
 const box=element("div",undefined,"home-empty");
 box.append(element("strong",heading),element("p",description));
 if(href){const a=element("a",label,"quiet-link");a.href=href;box.append(a);}
 parent.append(box);
}
function renderJobs(jobs){
 const holder=$("recentJobs");holder.replaceChildren();
 if(!jobs?.length)return empty(holder,"No jobs yet","Builds and other approved operations will appear here.","/jobs","Open Jobs");
 for(const job of jobs.slice(0,5)){
  const source=job.source?.repository?" · "+job.source.repository:"";
  row(holder,job.capability,(job.created_at?relative(job.created_at):"")+" · "+job.runner_id.slice(0,10)+source,job.status.replaceAll("_"," "));
 }
}
function renderProjects(projects){
 const holder=$("projectList");holder.replaceChildren();
 if(!projects?.repositories?.length){
  return empty(holder,projects?.organization?"No projects discovered":"GitHub organization not connected",
   projects?.organization?"Open Projects to synchronize your GitHub App repositories.":"Connect GitHub in Settings to view your repositories.",
   projects?.organization?"/projects":"/settings","Open "+(projects?.organization?"Projects":"Settings"));
 }
 for(const project of projects.repositories.slice(0,5)){
  row(holder,project.fullName,project.description||"Default branch: "+(project.defaultBranch||"unknown"),
   project.builds+" build"+(project.builds===1?"":"s"));
 }
}
function renderBuilders(overview){
 const holder=$("buildersList");holder.replaceChildren();
 const list=overview.runners?.items||[];
 if(!list.length)return empty(holder,"No build machines enrolled","Enroll a trusted Linux, macOS or Windows host to begin recording capabilities and jobs.",
  "/builders","Manage build machines");
 for(const runner of list.slice(0,5)){
  const recent=Number.isFinite(Date.parse(runner.lastSeen))&&Date.now()-Date.parse(runner.lastSeen)<120000;
  row(holder,runner.name,runner.os+" / "+runner.arch,recent?"Online":relative(runner.lastSeen));
 }
}
function renderDevices(inventory){
 const holder=$("devicesList");holder.replaceChildren();
 const list=inventory?.devices||[];
 if(!list.length)return empty(holder,"No devices reported","USB serial devices appear automatically when an enrolled builder has read-only discovery enabled.",
  "/devices","Open device inventory");
 for(const device of list.slice(0,6)){
  row(holder,device.label||device.product||device.description||"USB serial device",
   device.runnerName+" · "+device.port+" · "+device.vid.toString(16).padStart(4,"0")+":"+device.pid.toString(16).padStart(4,"0"),
   device.lifecycle==="connected"?"Connected":"Last seen "+relative(device.lastSeen));
 }
}
let refreshing=false;
async function load(){
 if(refreshing)return;
 refreshing=true;
 $("refresh").disabled=true;
 try{
  const [overview,projects,devices]=await Promise.all([
   api("/api/local/overview"),api("/api/local/projects"),api("/api/local/devices")]);
  $("username").textContent=overview.username||"administrator";
  $("workspaceOrg").textContent=overview.github?.organization||overview.github?.savedOrganization||"GitHub organization";
  statusText("projectCount",String(projects.repositories?.length||0));
  statusText("projectMeta",projects.updatedAt?"Synced "+relative(projects.updatedAt):"Not synced yet");
  const missing=(projects.repositories||[]).filter(p=>p.alert).length;
  const notice=$("builderCoverageNotice");notice.replaceChildren();
  if(missing){
   notice.append(element("span",missing+" active project"+(missing===1?" needs":"s need")+" a compatible build machine. "));
   const a=element("a","Review project requirements →","quiet-link");a.href="/projects?filter=missing";notice.append(a);
  }
  statusText("builderCount",String(overview.runners?.count||0));
  const online=(overview.runners?.items||[]).filter(r=>r.lastSeen&&Date.now()-Date.parse(r.lastSeen)<120000).length;
  statusText("builderMeta",online+" reporting recently");
  statusText("deviceCount",String(devices.summary?.connected||0));
  statusText("deviceMeta",String(devices.summary?.offline||0)+" offline · "+String(devices.summary?.hidden||0)+" hidden");
  statusText("jobCount",String(overview.jobs?.count||0));
  statusText("jobMeta",String(overview.jobs?.running||0)+" running · "+String(overview.jobs?.pending||0)+" approvals");
  statusText("gitStatus",overview.github?.identityConnected&&overview.github?.organization?
   "GitHub: "+overview.github.organization:overview.github?.authorizationExpired?"GitHub: reconnect required":"GitHub: not connected");
  statusText("aiStatus",overview.topology?.remoteMcpVerified?"Connected":"Not connected");
  statusText("tunnelCount",String(overview.topology?.verifiedTunnelCount??0));
  statusText("agentCount",String(overview.assistant?.connectedAgents??0));
  renderJobs(overview.jobs?.recent||[]);
  renderProjects(projects);
  renderBuilders(overview);
  renderDevices(devices);
  $("statusMessage").textContent="";
  $("updatedAt").textContent="Updated "+new Date().toLocaleTimeString()+" · Auto-refresh every 30s";
 }catch(e){$("statusMessage").textContent=e.message;}
 finally{refreshing=false;$("refresh").disabled=false;}
}
$("refresh").addEventListener("click",load);
load();
setInterval(()=>{if(!document.hidden)load();},30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)load();});