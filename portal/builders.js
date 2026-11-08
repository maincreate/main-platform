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
// The Host Service currently supports these six Node.js 22+ 64-bit platforms.
// These commands install no OS daemon and require no inbound connection.
const builderPlatforms=Object.freeze({
 linux:{
  shell:"a terminal (Bash or compatible shell)",
  details:{arm64:"64-bit ARM Linux (including Raspberry Pi OS 64-bit).",x64:"64-bit Intel/AMD Linux."},
  prerequisites:"Install Git and Node.js 22+ for this CPU. 32-bit ARM is not supported.",
  cd:"cd tinkertunnel",pair:"node runner/service.mjs pair",run:"node runner/service.mjs run"
 },
 macos:{
  shell:"Terminal (zsh)",
  details:{arm64:"Apple silicon Mac (M1 or later).",x64:"Intel Mac."},
  prerequisites:"Install Git (Xcode Command Line Tools is one option) and Node.js 22+ for this architecture.",
  cd:"cd tinkertunnel",pair:"node runner/service.mjs pair",run:"node runner/service.mjs run"
 },
 windows:{
  shell:"PowerShell",
  details:{arm64:"Windows on ARM64; use an ARM64 Node.js runtime.",x64:"64-bit Intel/AMD Windows."},
  prerequisites:"Install Git for Windows and Node.js 22+ for your CPU architecture. Restart PowerShell so both are on PATH.",
  cd:"Set-Location .\\tinkertunnel",pair:"node .\\runner\\service.mjs pair",run:"node .\\runner\\service.mjs run"
 }
});
function platformCommands(os,arch){
 const platform=builderPlatforms[os];
 if(!platform||!Object.hasOwn(platform.details,arch))throw Error("Unsupported builder platform");
 const expected={linux:"linux",macos:"darwin",windows:"win32"}[os]+"/"+arch;
 return {prepare:[
  "node --version",
  "git --version",
  'node -p "process.platform + \'/\' + process.arch"',
  "# Verify the result above equals "+expected+" before proceeding",
  "git clone https://github.com/TinkerTunnel/tinkertunnel.git",
  platform.cd,
  platform.pair
 ].join("\n"),run:platform.run,platform};
}
function updateBuilderInstructions(){
 const os=$("builderOS").value,arch=$("builderArch").value;
 const selected=platformCommands(os,arch);
 $("platformDetails").textContent=selected.platform.details[arch];
 $("platformPrerequisites").textContent=selected.platform.prerequisites;
 $("platformTerminal").textContent=selected.platform.shell;
 $("installCommand").textContent=selected.prepare;
 $("runCommand").textContent=selected.run;
 $("dialogCopyStatus").textContent="";
}
function wizardStep(step){
 for(const [id,index] of [["builderStepOne",1],["builderStepTwo",2],["builderStepThree",3]]){
  $(id).hidden=index!==step;
 }
 for(const [id,index] of [["stepOneMarker",1],["stepTwoMarker",2],["stepThreeMarker",3]]){
  $(id).classList.toggle("active",index===step);
 }
}
let selectedPendingHost=null;
async function loadPairing(id){
 if(!/^[a-f0-9]{32}$/.test(id)){
  $("hostPairStatus").textContent="Enter the 32-character pairing ID printed on your build machine.";
  $("hostPairDetails").hidden=true;selectedPendingHost=null;return;
 }
 $("hostPairStatus").textContent="Looking up the host announcement...";
 $("hostPairDetails").hidden=true;selectedPendingHost=null;
 try{
  const response=await api("/api/local/builders/pending");
  const candidate=(response.hosts||[]).find(x=>x.id===id&&x.status==="pending");
  if(!candidate)throw Error("Host not found. Run the pair command on the machine and use its latest pairing URL.");
  selectedPendingHost=candidate;
  $("pairHostName").textContent=candidate.name;
  $("pairHostPlatform").textContent=candidate.os+" / "+candidate.arch;
  $("pairHostFingerprint").textContent=candidate.fingerprint;
  $("confirmHostPair").checked=false;$("approveHostPair").disabled=true;
  $("hostPairDetails").hidden=false;
  $("hostPairStatus").textContent="Compare this fingerprint to the build machine's terminal output.";
 }catch(e){$("hostPairStatus").textContent=e.message;}
}
function openDialog(){
 $("controllerAddress").textContent=location.origin;
 updateBuilderInstructions();
 $("hostPairId").value="";
 $("confirmHostPair").checked=false;
 $("hostPairDetails").hidden=true;
 $("hostPairStatus").textContent="";
 $("dialogCopyStatus").textContent="";
 selectedPendingHost=null;
 const query=new URLSearchParams(location.search);
 const pairingId=(query.get("pair")||"").toLowerCase();
 if(query.get("add")==="1"&&/^[a-f0-9]{32}$/.test(pairingId)){
  wizardStep(2);$("hostPairId").value=pairingId;
  loadPairing(pairingId);
 }else wizardStep(1);
 $("addBuilderDialog").showModal();
}
$("builderOS").addEventListener("change",updateBuilderInstructions);
$("builderArch").addEventListener("change",updateBuilderInstructions);
$("builderNext").addEventListener("click",()=>wizardStep(2));
$("builderBack").addEventListener("click",()=>wizardStep(1));
$("addBuilder").addEventListener("click",openDialog);
$("cancelBuilder").addEventListener("click",()=> $("addBuilderDialog").close());
$("builderDone").addEventListener("click",()=>{
 $("addBuilderDialog").close();load().catch(e=>status(e.message));
});
$("lookupHostPair").addEventListener("click",()=>loadPairing($("hostPairId").value.trim().toLowerCase()));
$("hostPairId").addEventListener("input",()=>{
 selectedPendingHost=null;$("hostPairDetails").hidden=true;$("confirmHostPair").checked=false;
 $("approveHostPair").disabled=true;
});
$("confirmHostPair").addEventListener("change",()=>{
 $("approveHostPair").disabled=!$("confirmHostPair").checked||!selectedPendingHost;
});
$("approveHostPair").addEventListener("click",async()=>{
 const host=selectedPendingHost;
 if(!host||!$("confirmHostPair").checked)return;
 $("approveHostPair").disabled=true;
 $("hostPairStatus").textContent="Approving verified host...";
 try{
  await api("/api/local/builders/approve",
   {id:host.id,fingerprint:host.fingerprint,confirmed:true});
  $("hostPairStatus").textContent="Approved. The host will complete enrollment.";
  wizardStep(3);
 }catch(e){$("hostPairStatus").textContent=e.message; $("approveHostPair").disabled=false;}
});
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
