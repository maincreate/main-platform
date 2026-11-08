"use strict";
const $=id=>document.getElementById(id);
let csrf=null,builders=[],githubRunners=[],hostActions=[],fingerprint=null,verifiedHost=null;
try{const t=localStorage.getItem("tt-theme");if(["graphite","paper","midnight"].includes(t))document.body.dataset.theme=t;}catch{}
async function api(path,body){
 const request={credentials:"same-origin",cache:"no-store"};
 if(body!==undefined){request.method="POST";request.headers={"content-type":"application/json","x-tt-csrf":csrf};request.body=JSON.stringify(body);}
 const response=await fetch(path,request);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"Request failed (HTTP "+response.status+")");
 return data;
}
function el(tag,value,cls){const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;return n;}
function status(message){$("notification").textContent=message||"";}
function pairStatus(message){$("pairProgress").textContent=message||"";}
function currentState(host){return host.lastSeen&&Date.now()-Date.parse(host.lastSeen)<120000?"online":"offline";}
function recentAction(host){return [...hostActions].reverse().find(a=>a.runnerId===host.id)||null;}
function renderBuilders(){
 const holder=$("runners-list");holder.replaceChildren();
 const search=$("builderSearch").value.toLowerCase().trim(),filter=$("builderStatus").value;
 const shown=builders.filter(host=>(filter==="all"||filter===currentState(host))&&
  (!search||[host.name,host.os,host.arch,...(host.packages||[]).map(p=>p.name)].join(" ").toLowerCase().includes(search)));
 if(!shown.length){holder.append(el("p","No builders match this filter."));return}
 const table=el("table",undefined,"inventory-table"),head=el("tr");
 for(const label of ["Hostname","Platform","Host service","Toolchains","GitHub runner","Actions"])head.append(el("th",label));
 const thead=el("thead");thead.append(head);table.append(thead);
 const tbody=el("tbody");
 for(const host of shown){
  const tr=el("tr");
  tr.append(el("td",host.name),el("td",(host.os||"unknown")+" / "+(host.arch||"unknown")),
   el("td",currentState(host)==="online"?"Online":"Offline"));
  const tools=el("td"),packages=host.packages||[];
  if(packages.length){
   const details=el("details"),summary=el("summary",packages.length+" detected"),ul=el("ul");
   for(const p of packages)ul.append(el("li",p.name+" · "+p.version));
   details.append(summary,ul);tools.append(details);
  }else tools.textContent="Not yet reported";
  tr.append(tools);
  const action=recentAction(host),state=action?.status,runnerCell=el("td");
  if(host.githubRunnerName){
   const known=githubRunners.find(r=>r.name===host.githubRunnerName);
   runnerCell.textContent=host.githubRunnerName+(known?" · "+known.status:" · configured, verify in GitHub");
  }else if(state==="queued"||state==="claimed")runnerCell.textContent="Registering "+host.name+" · "+state;
  else if(state==="failed"||state==="expired")runnerCell.textContent="Registration "+state+(action.message?" · "+action.message:"");
  else if(host.managedHost)runnerCell.textContent="Paired · not registered";
  else runnerCell.textContent="Not controller-managed";
  tr.append(runnerCell);
  const controls=el("td");
  if(host.managedHost&&!host.githubRunnerName){
   if(state==="queued"||state==="claimed")controls.textContent="Controller provisioning";
   else{
    const button=el("button",state==="failed"||state==="expired"?"Retry registration":"Register GitHub runner","plain-button");
    button.type="button";button.disabled=currentState(host)!=="online";
    button.addEventListener("click",async()=>{
     button.disabled=true;status("Requesting GitHub runner registration for "+host.name);
     try{const result=await api("/api/local/builders/provision",{runnerId:host.id});
      status(result.action.existing?"Registration already in progress for "+host.name:"Controller queued GitHub runner "+result.action.runnerName);
      await load();
     }catch(e){status(e.message)}finally{button.disabled=false}
    });controls.append(button);
   }
  }else if(host.githubRunnerName)controls.textContent="Managed";
  else controls.textContent="—";
  tr.append(controls);tbody.append(tr);
 }
 table.append(tbody);holder.append(table);
}
function renderGithub(){
 const holder=$("githubRunners");holder.replaceChildren();
 if(!githubRunners.length){holder.textContent="No organization runners returned. Connect GitHub or check runner-management permissions.";return}
 const table=el("table",undefined,"inventory-table"),head=el("tr");
 for(const label of ["Runner","Platform","Status","Labels","Manage"])head.append(el("th",label));
 const thead=el("thead");thead.append(head);table.append(thead);const tbody=el("tbody");
 for(const runner of githubRunners){
  const tr=el("tr");tr.append(el("td",runner.name),el("td",runner.os||"—"),
   el("td",runner.status+(runner.busy?" · Busy":"")));
  const labels=(runner.labels||[]).map(l=>l.name);tr.append(el("td",labels.join(", ")));
  const controls=el("td");
  if(builders.some(host=>host.githubRunnerName===runner.name)){
   const button=el("button","Edit labels","plain-button");button.type="button";
   button.addEventListener("click",async()=>{
    const current=(runner.labels||[]).filter(l=>l.type==="custom").map(l=>l.name).join(", ");
    const answer=prompt("Comma-separated tt- labels for "+runner.name,current);
    if(answer===null)return;
    const labels=answer.split(",").map(x=>x.trim()).filter(Boolean);
    button.disabled=true;
    try{await api("/api/local/builders/github-runners/labels",{runnerId:runner.id,runnerName:runner.name,labels});
     await load();}catch(e){status(e.message)}finally{button.disabled=false}
   });controls.append(button);
  }
  tr.append(controls);tbody.append(tr);
 }
 table.append(tbody);holder.append(table);
}
async function load(){
 const overview=await api("/api/local/overview");
 csrf=overview.csrf;$("username").textContent=overview.username||"administrator";
 builders=overview.runners?.items||[];
 try{
  const history=await api("/api/local/builders/actions");hostActions=history.actions||[];
  const list=$("hostActions");list.replaceChildren();
  for(const job of hostActions.slice(-10).reverse())
   list.append(el("p",job.runnerName+" · "+job.status+(job.message?" · "+job.message:"")));
  if(!list.childNodes.length)list.textContent="No provisioning actions yet.";
 }catch(e){$("hostActions").textContent=e.message}
 try{
  const listing=await api("/api/local/builders/github-runners");
  githubRunners=listing.runners||[];renderGithub();
 }catch(e){githubRunners=[];$("githubRunners").textContent=e.message}
 renderBuilders();
}
function resetVerification(){
 fingerprint=null;verifiedHost=null;
 $("hostVerification").hidden=true;$("confirmFingerprint").checked=false;
 $("hostFingerprint").textContent="";pairStatus("");
}
function openDialog(){
 resetVerification();
 $("controllerAddress").textContent=location.origin;
 const origin=location.origin;
 // A temp file and && keep curl failures from being mistaken for a successful empty pipe install.
 const cmd="curl -fsSLo /tmp/tinkertunnel-install.sh "+origin+
  "/install.sh && sudo env TT_CONTROLLER_URL="+origin+" bash /tmp/tinkertunnel-install.sh";
 $("installCommand").textContent=cmd;
 $("discoveredHosts").replaceChildren();
 $("addBuilderDialog").showModal();
}
$("addBuilder").addEventListener("click",openDialog);
$("cancelBuilder").addEventListener("click",()=>{$("hostPassword").value="";$("addBuilderDialog").close()});
$("refresh").addEventListener("click",()=>load().catch(e=>status(e.message)));
$("builderSearch").addEventListener("input",renderBuilders);
$("builderStatus").addEventListener("change",renderBuilders);
$("hostAddress").addEventListener("input",resetVerification);
$("hostUsername").addEventListener("input",resetVerification);
$("hostPassword").addEventListener("input",resetVerification);
$("confirmFingerprint").addEventListener("change",()=>{$("pairHost").disabled=!$("confirmFingerprint").checked});
$("copyInstallCommand").addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText($("installCommand").textContent.trim());pairStatus("Install command copied.")}
 catch{pairStatus("Clipboard unavailable. Select the command above to copy.")}
});
$("discoverHosts").addEventListener("click",async()=>{
 const button=$("discoverHosts");button.disabled=true;pairStatus("Looking for installed Host Services...");
 try{
  const result=await api("/api/local/builders/discover"),box=$("discoveredHosts");box.replaceChildren();
  for(const host of result.hosts||[]){
   const button=el("button",host.name+" · "+(host.address||host.hostname),"plain-button");
   button.type="button";button.addEventListener("click",()=>{
    $("hostAddress").value=host.address||host.hostname;resetVerification();pairStatus("Selected "+host.name+". Enter the Pi login to continue.");
   });box.append(button);
  }
  pairStatus(result.hosts?.length?result.hosts.length+" nearby Host Service(s) found. Select one or enter its hostname.":result.warning||"No host discovered. Enter the Pi hostname or IP manually.");
 }catch(e){pairStatus(e.message)}finally{button.disabled=false}
});
$("checkHost").addEventListener("click",async()=>{
 resetVerification();
 const host=$("hostAddress").value.trim(),username=$("hostUsername").value.trim(),password=$("hostPassword").value;
 if(!host||!username||!password){pairStatus("Enter the Pi's hostname/IP, local username, and password.");return}
 const button=$("checkHost");button.disabled=true;pairStatus("Checking SSH host identity for "+host+"...");
 try{
  const result=await api("/api/local/builders/fingerprint?host="+encodeURIComponent(host));
  fingerprint=result.fingerprint;verifiedHost=host;
  $("hostFingerprint").textContent="SSH Ed25519: "+fingerprint;
  $("hostVerification").hidden=false;$("pairHost").disabled=true;
  pairStatus("Compare the fingerprint on the Pi, then confirm to pair. GitHub registration follows automatically.");
 }catch(e){pairStatus(e.message)}finally{button.disabled=false}
});
$("pairHost").addEventListener("click",async()=>{
 const host=$("hostAddress").value.trim(),username=$("hostUsername").value.trim();
 const password=$("hostPassword").value;
 if(!fingerprint||verifiedHost!==host||!$("confirmFingerprint").checked){pairStatus("Check and confirm this Pi's SSH fingerprint.");return}
 if(!username||!password){pairStatus("Enter the Pi's local username and password.");return}
 const button=$("pairHost");button.disabled=true;pairStatus("Pairing "+host+" and requesting GitHub registration...");
 try{
  const result=await api("/api/local/builders/pair",{host,username,password,fingerprint,confirmFingerprint:true});
  $("hostPassword").value="";
  $("addBuilderDialog").close();
  await load();
  status(result.provisioning?
   result.runner.name+" paired · GitHub Actions registration queued under hostname "+result.provisioning.runnerName:
   result.runner.name+" paired; GitHub registration needs attention: "+(result.provisioningError||"retry after host comes online"));
 }catch(e){pairStatus(e.message)}
 finally{$("hostPassword").value="";button.disabled=false}
});
if(new URLSearchParams(location.search).get("add")==="1")openDialog();
load().catch(e=>status(e.message));
setInterval(()=>{if(!document.hidden&&!$("addBuilderDialog").open)load().catch(()=>{});},12000);
