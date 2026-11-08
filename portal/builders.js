"use strict";
const $=id=>document.getElementById(id);
let csrf=null,builders=[],githubRunners=[];
try{const t=localStorage.getItem("tt-theme");if(["graphite","paper","midnight"].includes(t))document.body.dataset.theme=t;}catch{}
async function api(path,body){
 const request={credentials:"same-origin",cache:"no-store"};
 if(body!==undefined){request.method="POST";request.headers={"content-type":"application/json","x-tt-csrf":csrf};request.body=JSON.stringify(body);}
 const response=await fetch(path,request);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"Request failed");
 return data;
}
function el(tag,value,cls){const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;return n;}
function status(text){$("notification").textContent=text||"";}
function currentState(item){return item.lastSeen&&Date.now()-Date.parse(item.lastSeen)<120000?"online":"offline";}
function renderBuilders(){
 const holder=$("runners-list");holder.replaceChildren();
 const search=$("builderSearch").value.toLowerCase().trim(),state=$("builderStatus").value;
 const shown=builders.filter(r=>(state==="all"||state===currentState(r))&&
  (!search||[r.name,r.os,r.arch,...(r.packages||[]).map(p=>p.name)].join(" ").toLowerCase().includes(search)));
 if(!shown.length)return;
 const table=el("table",undefined,"inventory-table"),head=el("tr");
 for(const name of ["Machine","Platform","Connection","Toolchains and packages","Labels","Manage"])head.append(el("th",name));
 const thead=el("thead");thead.append(head);table.append(thead);const tbody=el("tbody");
 for(const r of shown){
  const tr=el("tr");tr.append(el("td",r.name),el("td",(r.os||"unknown")+" / "+(r.arch||"unknown")),
   el("td",currentState(r)==="online"?"Online":"Offline"));
  const tools=el("td");
  const packages=r.packages||[];
  if(packages.length){
   const details=el("details"),summary=el("summary",packages.length+" detected");
   details.append(summary);
   const ul=el("ul");
   for(const p of packages)ul.append(el("li",p.name+" · "+p.version));
   details.append(ul);tools.append(details);
  }else tools.textContent="Not reported";
  tr.append(tools,el("td",(r.labels||[]).join(", ")||"—"));
  const actions=el("td");
  if(r.managedHost&&!r.githubRunnerName){
   const button=el("button","Provision GitHub runner","plain-button");button.type="button";
   button.disabled=currentState(r)!=="online";
   button.addEventListener("click",async()=>{
    button.disabled=true;status("Controller requesting GitHub registration for "+r.name);
    try{const result=await api("/api/local/builders/provision",{runnerId:r.id});status("Provisioning queued: "+result.action.runnerName);await load()}
    catch(e){status(e.message)}finally{button.disabled=false}
   });actions.append(button);
  }else if(r.githubRunnerName){actions.textContent="Runner: "+r.githubRunnerName}
  else {actions.textContent="Host service only"}
  tr.append(actions);tbody.append(tr);
 }
 table.append(tbody);holder.append(table);
}
function renderGithub(){
 const holder=$("githubRunners");holder.replaceChildren();
 if(!githubRunners.length)return;
 const table=el("table",undefined,"inventory-table"),head=el("tr");
 for(const name of ["Runner","Platform","Status","Labels","Manage"])head.append(el("th",name));
 const thead=el("thead");thead.append(head);table.append(thead);const tbody=el("tbody");
 for(const r of githubRunners){
  const tr=el("tr");tr.append(el("td",r.name),el("td",r.os||"—"),
   el("td",r.status+(r.busy?" · Busy":"")));
  const labels=(r.labels||[]).map(l=>l.name);
  tr.append(el("td",labels.join(", ")));
  const controls=el("td");
  const managed=builders.some(b=>b.githubRunnerName===r.name);
  if(managed){
   const button=el("button","Edit labels","plain-button");
   button.type="button";
   button.addEventListener("click",async()=>{
    const current=r.labels.filter(l=>l.type==="custom").map(l=>l.name).join(", ");
    const answer=prompt("Comma-separated tt- labels for "+r.name,current);
    if(answer===null)return;
    const labels=answer.split(",").map(x=>x.trim()).filter(Boolean);
    button.disabled=true;
    try{await api("/api/local/builders/github-runners/labels",{runnerId:r.id,runnerName:r.name,labels});
     await load();
    }catch(e){status(e.message);}finally{button.disabled=false;}
   });
   controls.append(button);
  }
  tr.append(controls);tbody.append(tr);
 }
 table.append(tbody);holder.append(table);
}
async function load(){
 const overview=await api("/api/local/overview");
 csrf=overview.csrf;
 $("username").textContent=overview.username||"administrator";
 builders=overview.runners?.items||[];
 renderBuilders();
 try{
  const listing=await api("/api/local/builders/github-runners");
  githubRunners=listing.runners||[];renderGithub();
 }catch(e){$("githubRunners").textContent=e.message;}
 try{
  const history=await api("/api/local/builders/actions");
  const list=$("hostActions");list.replaceChildren();
  for(const job of (history.actions||[]).slice(-10).reverse()){
   const p=el("p",job.runnerName+" · "+job.status+(job.message?" · "+job.message:""));
   list.append(p);
  }
  if(!list.childNodes.length)list.textContent="No controller provisioning actions yet.";
 }catch(e){$("hostActions").textContent=e.message}
}
// Only architectures recognized by runner/agent.mjs are offered.
// These are source-based Node.js instructions, not native installers.
const builderPlatforms=Object.freeze({
 linux:{
  name:"Linux",shell:"a terminal (Bash or compatible shell)",
  details:{arm64:"64-bit ARM Linux (e.g., Raspberry Pi OS 64-bit); use an ARM64 build of Node.js.",x64:"64-bit Intel/AMD Linux; use an x64 build of Node.js."},
  prerequisites:"Install Git and Node.js 22+ for the selected CPU architecture. The OS must be 64-bit; 32-bit ARM is not supported.",
  cd:"cd tinkertunnel",pair:"node runner/service.mjs pair",run:"node runner/service.mjs run"
 },
 macos:{
  name:"macOS",shell:"Terminal (zsh)",
  details:{arm64:"Apple silicon Macs (M1 or later); use native ARM64 Node.js.",x64:"Intel Macs; use an x64 build of Node.js."},
  prerequisites:"Install Git (Xcode Command Line Tools is one option) and Node.js 22+ for your Mac architecture.",
  cd:"cd tinkertunnel",pair:"node runner/service.mjs pair",run:"node runner/service.mjs run"
 },
 windows:{
  name:"Windows",shell:"PowerShell",
  details:{arm64:"Windows on ARM64; use ARM64 Node.js, not an emulated x64 process.",x64:"64-bit Intel/AMD Windows; use an x64 build of Node.js."},
  prerequisites:"Install Git for Windows and Node.js 22+ for the selected architecture. Open PowerShell and verify both commands are available in PATH.",
  cd:"Set-Location .\\tinkertunnel",pair:"node .\\runner\\service.mjs pair",run:"node .\\runner\\service.mjs run"
 }
});
function platformCommands(os,arch){
 const p=builderPlatforms[os];
 if(!p||!Object.hasOwn(p.details,arch))throw Error("Unsupported builder platform");
 const verify= os==="windows"? 'node -p "process.platform + \'/\' + process.arch"':'node -p "process.platform + \'/\' + process.arch"';
 const expect={linux:"linux",macos:"darwin",windows:"win32"}[os]+"/"+arch;
 return {prepare:[
  "node --version",
  "git --version",
  verify,
  "# Expected platform: "+expect,
  "git clone https://github.com/TinkerTunnel/tinkertunnel.git",
  p.cd,p.pair
 ].join("\n"),run:p.run,platform:p};
}
function updateBuilderInstructions(){
 const os=$("builderOS").value,arch=$("builderArch").value;
 const options=platformCommands(os,arch);
 $("platformDetails").textContent=options.platform.details[arch];
 $("platformPrerequisites").textContent=options.platform.prerequisites;
 $("platformTerminal").textContent=options.platform.shell;
 $("installCommand").textContent=options.prepare;
 $("runCommand").textContent=options.run;
 $("dialogCopyStatus").textContent="";
}
$("builderOS").addEventListener("change",updateBuilderInstructions);
$("builderArch").addEventListener("change",updateBuilderInstructions);
function openDialog(){
 $("controllerAddress").textContent=location.origin;
 updateBuilderInstructions();
 $("addBuilderDialog").showModal();
}
$("addBuilder").addEventListener("click",openDialog);
$("cancelBuilder").addEventListener("click",()=>$("addBuilderDialog").close());
$("refresh").addEventListener("click",()=>load().catch(e=>status(e.message)));
$("builderSearch").addEventListener("input",renderBuilders);
$("builderStatus").addEventListener("change",renderBuilders);

async function copyCommand(id){
 const command=$(id).textContent.trim();
 const output=$("dialogCopyStatus");
 try{
  if(!navigator.clipboard?.writeText)throw Error("Clipboard unavailable");
  await navigator.clipboard.writeText(command);
  output.textContent="Commands copied.";
 }catch{
  output.textContent="Copy is unavailable in this browser; select the command text above to copy manually.";
 }
}
$("copyInstallCommand").addEventListener("click",()=>copyCommand("installCommand"));
$("copyRunCommand").addEventListener("click",()=>copyCommand("runCommand"));

if(new URLSearchParams(location.search).get("add")==="1")openDialog();
load().catch(e=>status(e.message));
