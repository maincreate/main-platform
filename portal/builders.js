"use strict";
const $=id=>document.getElementById(id);
let csrf=null,builders=[],githubRunners=[],hostActions=[];
let platform="linux-arm64",method="manual",step=1;
let fingerprint=null,verifiedHost=null,identitySerial=0;
let selectedDiscoveryHost=null,scanActive=false,scanDeadline=0,scanTimer=null,scanClock=null,scanRequest=null,scanSerial=0,scanLastHosts=new Map(),pairing=false;
const SCAN_MAX_MS=5*60*1000,SCAN_INTERVAL_MS=12000;
try{const t=localStorage.getItem("tt-theme");if(["graphite","paper","midnight"].includes(t))document.body.dataset.theme=t;}catch{}
async function api(path,body,signal){
 const request={credentials:"same-origin",cache:"no-store"};
 if(signal)request.signal=signal;
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

function removalStatus(host){
 const phase=host.decommission?.phase;
 if(phase==="failed")return "Removal failed: "+(host.decommission.error||"Unknown error");
 const names={requested:"Stopping runner",stopping:"Stopping runner",unregistering:"Unregistering from Github",unregistered:"Removing Software",cleaning:"Removing Software",cleanup_scheduled:"Removing from Controller",controller:"Removing from Controller"};
 return "Removal in Progress: "+(names[phase]||"Preparing removal");
}
function builderSignals(host){
 const reachable=currentState(host)==="online";
 const runner=githubRunners.find(r=>r.name===host.githubRunnerName);
 const sw=host.software||{};
 return {
  host:{level:reachable?"good":"bad",text:reachable?"Reachable":"Not reachable"},
  software:!reachable?{level:"unknown",text:"Unavailable while offline"}:
   sw.error||!host.managedHost?{level:"bad",text:"Software communication error"}:
   sw.updateAvailable?{level:"warn",text:"Update available"}:
   sw.upToDate===true?{level:"good",text:"Installed · up to date"}:
   {level:"unknown",text:"Installed · version unverified"},
  github:!host.githubRunnerName?{level:"bad",text:"Not registered"}:
   !runner?{level:"warn",text:"Registered · GitHub check unavailable"}:
   runner.status!=="online"?{level:"warn",text:"Registered · "+runner.status}:
   {level:"good",text:"Registered · "+(runner.busy?"busy":"online")}
 };
}
function statusSignal(kind,label,signal){
 const wrap=el("span",undefined,"tt-builder-signal tt-signal-"+signal.level);
 wrap.title=label+": "+signal.text;wrap.setAttribute("aria-label",label+": "+signal.text);
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
 for(const [key,val] of Object.entries({viewBox:"0 0 24 24",width:"19",height:"19",fill:"none",stroke:"currentColor","stroke-width":"1.8","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"}))svg.setAttribute(key,val);
 const paths={server:["M4 3h16a1 1 0 0 1 1 1v6H3V4a1 1 0 0 1 1-1Z","M3 14h18v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z","M7 7h.01","M7 18h.01"],tools:["M14.7 6.3 17.7 3.3 20.7 6.3 17.7 9.3","M3 21l8.8-8.8","M4 4l16 16","M7 4 4 7"],github:["M9 19c-4.5 1.4-4.5-2.5-6.5-3","M9 22v-3.1c-3.4-.9-5-3-5-6.5 0-1.6.5-3 1.4-4.1-.3-1.1-.4-2.5.2-3.8 1.6 0 2.7.7 3.5 1.4a13 13 0 0 1 6 0c.8-.7 1.9-1.4 3.5-1.4.6 1.3.5 2.7.2 3.8.9 1.1 1.4 2.5 1.4 4.1 0 3.5-1.6 5.6-5 6.5V22"]};
 for(const d of paths[kind]){
  const node=document.createElementNS("http://www.w3.org/2000/svg","path");
  node.setAttribute("d",d);svg.append(node);
 }
 const symbol=el("span",undefined,"tt-builder-signal-icon");symbol.append(svg);
 wrap.append(symbol,el("span",signal.text,"tt-builder-signal-text"));return wrap;
}
function recentAction(host){return [...hostActions].reverse().find(a=>a.runnerId===host.id)||null;}
function builderStage(host){
 if(host.decommission?.phase==="failed")return "removal-failed";
 if(host.decommission)return "removing";
 const action=recentAction(host),connected=currentState(host)==="online";
 if(!host.githubRunnerName){
  if(action&&["queued","claimed"].includes(action.status))return "setting-up";
  return "setup-incomplete";
 }
 return connected?"healthy":"unreachable";
}
function menuAction(text,callback,disabled=false){
 const b=el("button",text,"tt-builder-menu-action");
 b.type="button";b.disabled=disabled;b.setAttribute("role","menuitem");
 b.addEventListener("click",event=>{
  const details=event.currentTarget.closest("details");if(details)details.open=false;
  callback();
 });
 return b;
}
async function requestRunnerSetup(host){
 status("Requesting GitHub registration for "+host.name+"…");
 try{
  const result=await api("/api/local/builders/provision",{runnerId:host.id});
  status(result.action.existing?"Registration already in progress: "+host.name:
    "Registration queued for "+host.name+". Validation will become available when it finishes.");
  await load();
 }catch(e){status("Registration failed: "+e.message)}
}
async function validateBuilder(host){
 status("Validating "+host.name+" against controller heartbeat and GitHub…");
 try{
  const result=await api("/api/local/builders/validate",{runnerId:host.id});
  const lines=[host.name+": "+(result.ready?"VALIDATED":"ATTENTION REQUIRED")];
  for(const item of result.checks||[])lines.push(item.label+": "+item.status+(item.detail?" — "+item.detail:""));
  status(lines.join(" | "));
  await load();
 }catch(e){status("Validation failed: "+e.message)}
}


const removeDialog=$("removeBuilderDialog");
let removeTarget=null;
let removeMode=null;
function openRemoveDialog(host,mode){
  removeTarget=host;removeMode=mode;
  const live=mode==="managed";
  $("removeBuilderName").value="";$("removeBuilderPassword").value="";
  $("removeBuilderExplanation").textContent=
    "Builder: "+host.name+". "+(live?
      "Connected: TinkerTunnel will stop the idle GitHub runner, unregister it, uninstall its managed software, and revoke this builder's enrollment.":
      "Force removal: TinkerTunnel will unregister any idle GitHub runner and revoke controller access without uninstalling this machine. You must uninstall or reimage the host manually.")+
    " Active builds cannot be removed. This action cannot be undone.";
  $("removeBuilderFeedback").textContent=host.decommission?.error?.includes("unsupported action")||
    host.decommission?.error?.includes("upgrade")?
    "The installed Host Service is outdated. Run the current TinkerTunnel installer on the host to upgrade it while keeping enrollment, then retry.":"";
  $("confirmRemoveBuilder").disabled=true;
  removeDialog.showModal();
}
function syncRemoveConfirmation(){
  $("confirmRemoveBuilder").disabled=!removeTarget||
   $("removeBuilderName").value!==removeTarget.name||
   !$("removeBuilderPassword").value;
}
$("removeBuilderName").addEventListener("input",syncRemoveConfirmation);
$("removeBuilderPassword").addEventListener("input",syncRemoveConfirmation);
$("cancelRemoveBuilder").addEventListener("click",()=>removeDialog.close());
$("removeBuilderForm").addEventListener("submit",async(event)=>{
 event.preventDefault();if(!removeTarget)return;
 const host=removeTarget,mode=removeMode;
 if($("removeBuilderName").value!==host.name)return;
 const password=$("removeBuilderPassword").value;
 $("confirmRemoveBuilder").disabled=true;
 $("removeBuilderFeedback").textContent="Starting "+mode+" removal…";
 try{
  const result=await api("/api/local/builders/remove",{
    runnerId:host.id,confirmName:host.name,password,mode
  });
  $("removeBuilderPassword").value="";removeDialog.close();removeTarget=null;
  if(result.removed){
    const output=$("builderRemovalInstructions");
    output.hidden=false;output.replaceChildren();
    output.append(el("strong",host.name+" removed from TinkerTunnel"));
    output.append(el("p","GitHub and controller access were removed. Local cleanup or reimaging remains your responsibility."));
    status("Remote removal completed for "+host.name+". Local cleanup is still required.");
  }else{
    status(host.name+": decommissioning "+(result.phase||"started")+". Follow status in the Builders table.");
  }
  await load();
 }catch(e){$("removeBuilderFeedback").textContent=e.message;}
 finally{syncRemoveConfirmation()}
});

function renderBuilders(){
 const holder=$("runners-list");holder.replaceChildren();
 const search=$("builderSearch").value.toLowerCase().trim(),filter=$("builderStatus").value;
 const shown=builders.filter(host=>(filter==="all"||filter===currentState(host))&&
  (!search||[host.name,host.os,host.arch,...(host.packages||[]).map(p=>p.name)].join(" ").toLowerCase().includes(search)));
 if(!shown.length){holder.append(el("p","No builders match this filter."));return}
 const table=el("table",undefined,"inventory-table"),head=el("tr");
 for(const label of ["Hostname","Platform","Build Host","TinkerTunnel Software","GitHub Registration","Toolchains","Status","Actions"])head.append(el("th",label));
 const thead=el("thead");thead.append(head);table.append(thead);const tbody=el("tbody");
 for(const host of shown){
  const tr=el("tr");
  tr.append(el("td",host.name),el("td",(host.os||"unknown")+" / "+(host.arch||"unknown")));
  const signals=builderSignals(host);
  for(const [kind,label,signal] of [["server","Build Host",signals.host],["tools","TinkerTunnel Software",signals.software],["github","GitHub Runner Registration",signals.github]]){
   const cell=el("td");cell.append(statusSignal(kind,label,signal));tr.append(cell);
  }
  const tools=el("td"),packages=host.packages||[];
  if(packages.length){
   const details=el("details"),summary=el("summary",packages.length+" detected"),ul=el("ul");
   for(const p of packages)ul.append(el("li",p.name+" · "+p.version));
   details.append(summary,ul);tools.append(details);
  }else tools.textContent="Not yet reported";
  tr.append(tools);
  const action=recentAction(host),state=action?.status,runnerCell=el("td");
  if(host.decommission)runnerCell.textContent=removalStatus(host);
  else if(host.githubRunnerName){
   const known=githubRunners.find(r=>r.name===host.githubRunnerName);
   const runnerOnline=String(known?.status||"").toLowerCase()==="online";
   runnerCell.textContent=(runnerOnline&&currentState(host)==="online"?"Ready":"Registered · not verified online")+
    " · "+host.githubRunnerName+(known?" · "+known.status:" · verify in GitHub");
  }else if(state==="queued")runnerCell.textContent="Runner setup queued · not ready";
  else if(state==="claimed")runnerCell.textContent="Runner installation / registration in progress · not ready";
  else if(state==="failed"||state==="expired")runnerCell.textContent="Runner setup "+state+" · not ready"+(action.message?" · "+action.message:"");
  else if(host.managedHost)runnerCell.textContent="Host paired · runner not installed · not ready";
  else runnerCell.textContent="Not controller-managed";
  tr.append(runnerCell);
  const controls=el("td");
  controls.replaceChildren();
  controls.classList.add("tt-builder-action-cell");
  const stage=builderStage(host);
  const menu=el("details",undefined,"tt-builder-action-menu");
  const trigger=el("summary","⋮","tt-builder-menu-trigger");
  trigger.setAttribute("aria-label","Actions for "+host.name);
  trigger.setAttribute("title","Builder actions");
  const panel=el("div",undefined,"tt-builder-menu-panel");
  panel.setAttribute("role","menu");

  if(stage==="setup-incomplete"){
   panel.append(menuAction("Retry GitHub registration",()=>requestRunnerSetup(host),
     currentState(host)!=="online"||!host.managedHost));
   panel.append(menuAction("Force remove",()=>openRemoveDialog(host,"remote"),false));
  }else if(stage==="healthy"){
   panel.append(menuAction("Validate runner",()=>validateBuilder(host)));
   panel.append(menuAction("Remove runner",()=>openRemoveDialog(host,"managed")));
  }else if(stage==="unreachable"){
   panel.append(menuAction("Validate runner",()=>validateBuilder(host)));
   panel.append(menuAction("Force remove",()=>openRemoveDialog(host,"remote")));
  }else if(stage==="removal-failed"){
   panel.append(menuAction("Validate runner",()=>validateBuilder(host)));
   panel.append(menuAction("Retry removal",()=>openRemoveDialog(host,currentState(host)==="online"?"managed":"remote")));
   panel.append(menuAction("Force remove",()=>openRemoveDialog(host,"remote")));
  }else{
   panel.append(el("span",stage==="removing"?removalStatus(host):"Setup in progress","tt-builder-menu-disabled"));
  }
  menu.append(trigger,panel);controls.append(menu);
  tr.append(controls);tbody.append(tr);
 }
 table.append(tbody);holder.append(table);
}
function renderGithub(){
 const holder=$("githubRunners");holder.replaceChildren();
 if(!githubRunners.length){holder.textContent="No organization runners returned. Connect GitHub or check runner-management permissions.";return}
 const table=el("table",undefined,"inventory-table"),head=el("tr");
 for(const label of ["Runner","Platform","Status","Version","Labels","Manage"])head.append(el("th",label));
 const thead=el("thead");thead.append(head);table.append(thead);const tbody=el("tbody");
 for(const runner of githubRunners){
  const tr=el("tr");tr.append(el("td",runner.name),el("td",runner.os||"—"),
   el("td",runner.status+(runner.busy?" · Busy":"")));
  const version=runner.version||null,available=runner.availableVersion||null;
  const software=version?"v"+version:"Not reported";
  const update=runner.updateAvailable?" · Update available: v"+available:
    version&&available&&version===available?" · Current":"";
  tr.append(el("td",software+update));
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
const dialog=$("addBuilderDialog");
function chosenHost(){return method==="manual"?$("hostAddress").value.trim():selectedDiscoveryHost;}
function clearIdentity(){
 identitySerial++;fingerprint=null;verifiedHost=null;
 $("confirmFingerprint").checked=false;$("hostFingerprint").textContent="";
 $("pairHost").disabled=true;
}
function hideDiscovery(){
 scanActive=false;scanSerial++;
 clearTimeout(scanTimer);clearInterval(scanClock);scanTimer=null;scanClock=null;
 if(scanRequest){scanRequest.abort();scanRequest=null;}
}
function scanStatusText(){
 if(!scanActive)return;
 const remaining=Math.max(0,Math.ceil((scanDeadline-Date.now())/1000));
 if(!remaining){hideDiscovery();$("discoveryStatus").textContent="Five-minute discovery window ended. Select Scan again or use Manual.";return;}
 const count=scanLastHosts.size;
 $("discoveryStatus").textContent="Scanning · "+count+" host"+(count===1?"":"s")+" seen · "+Math.floor(remaining/60)+":"+String(remaining%60).padStart(2,"0")+" left";
}
function renderDiscovered(){
 const box=$("discoveredHosts");box.replaceChildren();
 const hosts=[...scanLastHosts.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name))).slice(0,50);
 if(!hosts.length){
  const tr=el("tr"),cell=el("td","Searching this network. If your Pi is on a different VLAN, use Manual.");
  cell.colSpan=3;tr.append(cell);box.append(tr);return;
 }
 for(const host of hosts){
  const tr=el("tr"),addr=host.address||host.hostname;
  const choose=el("button",selectedDiscoveryHost===addr?"Selected":"Select","plain-button");
  choose.type="button";choose.setAttribute("aria-pressed",String(selectedDiscoveryHost===addr));
  choose.addEventListener("click",()=>{
   selectedDiscoveryHost=addr;clearIdentity();renderDiscovered();
   $("selectedHost").textContent="Selected: "+host.name+" · "+addr;
   pairStatus("Enter the host login and continue to fingerprint verification.");
  });
  tr.append(el("td",host.name),el("td",addr));
  const cell=el("td");cell.append(choose);tr.append(cell);box.append(tr);
 }
}
async function scanOnce(serial){
 if(!scanActive||serial!==scanSerial||!dialog.open||step!==2||method!=="discovery")return;
 if(Date.now()>=scanDeadline){scanStatusText();return;}
 const abort=new AbortController();scanRequest=abort;
 try{
  const result=await api("/api/local/builders/discover",undefined,abort.signal);
  if(!scanActive||serial!==scanSerial||step!==2||method!=="discovery")return;
  for(const host of result.hosts||[]){
   if(typeof host.hostname!=="string"||!host.hostname||Number(host.port)!==22)continue;
   const addr=host.address||host.hostname;
   scanLastHosts.set(addr,{name:host.name||host.hostname,hostname:host.hostname,address:host.address||null});
  }
  renderDiscovered();
  if(result.warning)pairStatus(result.warning);
 }catch(e){
  if(scanActive&&serial===scanSerial&&e.name!=="AbortError")pairStatus("Discovery is unavailable from this controller network. Manual pairing still works.");
 }finally{
  if(scanRequest===abort)scanRequest=null;
  if(scanActive&&serial===scanSerial){
   scanStatusText();
   if(scanActive)scanTimer=setTimeout(()=>scanOnce(serial),SCAN_INTERVAL_MS);
  }
 }
}
function startDiscovery(){
 hideDiscovery();
 scanActive=true;scanDeadline=Date.now()+SCAN_MAX_MS;
 const serial=scanSerial;scanLastHosts=new Map();
 $("discoveryStatus").textContent="Starting network discovery…";
 renderDiscovered();scanClock=setInterval(scanStatusText,1000);
 scanOnce(serial);
}
function activateTabs(buttons,active,attribute){
 for(const button of buttons){
  const on=button.dataset[attribute]===active;
  button.setAttribute("aria-selected",String(on));button.tabIndex=on?0:-1;
 }
}
function activatePlatform(value,focus=false){
 platform=value;
 const tabs=[...document.querySelectorAll(".tt-os-tabs [role=tab]")];
 activateTabs(tabs,value,"platform");
 for(const tab of tabs)$(tab.getAttribute("aria-controls")).hidden=tab.dataset.platform!==value;
 if(focus)tabs.find(t=>t.dataset.platform===value)?.focus();
 $("nextBuilder").disabled=value!=="linux-arm64";
 if(value!=="linux-arm64")pairStatus("Coming soon: this platform cannot yet be enrolled through the native installer.");
 else pairStatus("");
}
function activateMethod(value,focus=false){
 if(value===method&&scanActive)return;
 method=value;clearIdentity();
 const tabs=[...document.querySelectorAll(".tt-connect-tabs [role=tab]")];
 activateTabs(tabs,value,"method");
 $("connectManual").hidden=value!=="manual";
 $("connectDiscovery").hidden=value!=="discovery";
 if(focus)tabs.find(t=>t.dataset.method===value)?.focus();
 pairStatus("");
 if(value==="discovery")startDiscovery();else hideDiscovery();
}
function showStep(number){
 if(number!==2||method!=="discovery")hideDiscovery();
 step=number;
 for(let i=1;i<=3;i++)$("builderStep"+i).hidden=i!==number;
 for(const label of dialog.querySelectorAll("[data-step-indicator]")){
  if(Number(label.dataset.stepIndicator)===number)label.setAttribute("aria-current","step");
  else label.removeAttribute("aria-current");
 }
 $("backBuilder").hidden=number===1;
 $("nextBuilder").hidden=number===3;
 $("pairHost").hidden=number!==3;
 $("nextBuilder").disabled=number===1&&platform!=="linux-arm64";
 $("nextBuilder").textContent=number===1?"Next: Connect":"Verify identity";
 $("cancelBuilder").textContent="Cancel";
 pairStatus("");
}
function openDialog(){
 if(dialog.open)return;
 platform="linux-arm64";method="manual";step=1;selectedDiscoveryHost=null;pairing=false;
 clearIdentity();hideDiscovery();scanLastHosts=new Map();
 $("hostAddress").value="";$("hostUsername").value="";$("hostPassword").value="";
 $("selectedHost").textContent="No host selected.";
 $("installCommand").textContent="curl -fsSLo /tmp/tinkertunnel-install.sh "+location.origin+
  "/install.sh && sudo env TT_CONTROLLER_URL="+location.origin+" bash /tmp/tinkertunnel-install.sh";
 activatePlatform(platform);activateMethod("manual");showStep(1);
 dialog.showModal();
 $("platform-linux-arm64").focus();
}
function closeDialog(){if(!pairing&&dialog.open)dialog.close();}
dialog.addEventListener("close",()=>{
 hideDiscovery();clearIdentity();$("hostPassword").value="";pairing=false;
});
dialog.addEventListener("cancel",event=>{
 if(pairing)event.preventDefault();
});
dialog.addEventListener("click",event=>{
 if(pairing||event.target!==dialog)return;
 const rect=dialog.getBoundingClientRect();
 if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();
});
$("addBuilder").addEventListener("click",openDialog);
$("closeBuilder").addEventListener("click",closeDialog);
$("cancelBuilder").addEventListener("click",closeDialog);
$("refresh").addEventListener("click",()=>load().catch(e=>status(e.message)));
$("builderSearch").addEventListener("input",renderBuilders);
$("builderStatus").addEventListener("change",renderBuilders);
function tabKeyboard(event,tabs,choose){
 const keys=["ArrowRight","ArrowLeft","Home","End"];if(!keys.includes(event.key))return;
 event.preventDefault();const index=tabs.indexOf(event.currentTarget);
 const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:
   (index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
 choose(tabs[next].dataset[tabs[next].dataset.platform?"platform":"method"],true);
}
for(const tab of dialog.querySelectorAll(".tt-os-tabs [role=tab]")){
 tab.addEventListener("click",()=>activatePlatform(tab.dataset.platform));
 tab.addEventListener("keydown",event=>tabKeyboard(event,[...document.querySelectorAll(".tt-os-tabs [role=tab]")],activatePlatform));
}
for(const tab of dialog.querySelectorAll(".tt-connect-tabs [role=tab]")){
 tab.addEventListener("click",()=>activateMethod(tab.dataset.method));
 tab.addEventListener("keydown",event=>tabKeyboard(event,[...document.querySelectorAll(".tt-connect-tabs [role=tab]")],activateMethod));
}
for(const id of ["hostAddress","hostUsername","hostPassword"])$(id).addEventListener("input",clearIdentity);
$("copyInstallCommand").addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText($("installCommand").textContent.trim());pairStatus("Installation command copied.")}
 catch{pairStatus("Clipboard unavailable; select and copy the command.")}
});
$("restartDiscovery").addEventListener("click",()=>{
 if(method==="discovery"&&step===2){startDiscovery();pairStatus("");}
});
$("backBuilder").addEventListener("click",()=>{
 if(pairing)return;
 if(step===3){clearIdentity();showStep(2);if(method==="discovery")startDiscovery();}
 else if(step===2)showStep(1);
});
$("nextBuilder").addEventListener("click",async()=>{
 if(step===1){if(platform!=="linux-arm64")return;showStep(2);if(method==="discovery")startDiscovery();return;}
 if(step!==2||pairing)return;
 const host=chosenHost(),username=$("hostUsername").value.trim(),password=$("hostPassword").value;
 if(!host){pairStatus(method==="manual"?"Enter a hostname or IP address.":"Select a discovered machine, or switch to Manual.");return;}
 if(!username||!password){pairStatus("Enter the local Linux username and password.");return;}
 const serial=++identitySerial,button=$("nextBuilder");button.disabled=true;
 pairStatus("Reading SSH host fingerprint for "+host+" (credentials have not been sent)…");
 try{
  const result=await api("/api/local/builders/fingerprint?host="+encodeURIComponent(host));
  if(serial!==identitySerial||!dialog.open||step!==2||host!==chosenHost())return;
  fingerprint=result.fingerprint;verifiedHost=host;
  $("verifyHostAddress").textContent=host;
  $("hostFingerprint").textContent=fingerprint;
  $("confirmFingerprint").checked=false;$("pairHost").disabled=true;
  showStep(3);
 }catch(e){if(serial===identitySerial)pairStatus(e.message)}
 finally{button.disabled=false;}
});
$("confirmFingerprint").addEventListener("change",()=>{$("pairHost").disabled=!$("confirmFingerprint").checked;});
$("pairHost").addEventListener("click",async()=>{
 const host=chosenHost(),username=$("hostUsername").value.trim(),password=$("hostPassword").value;
 if(pairing||step!==3||!fingerprint||verifiedHost!==host||!$("confirmFingerprint").checked)return;
 if(!username||!password){pairStatus("Your local Linux credentials are required.");return;}
 pairing=true;const button=$("pairHost");button.disabled=true;
 $("backBuilder").disabled=true;$("cancelBuilder").disabled=true;$("closeBuilder").disabled=true;
 pairStatus("Pairing "+host+" over SSH and requesting runner registration…");
 try{
  const result=await api("/api/local/builders/pair",{host,username,password,fingerprint,confirmFingerprint:true});
  $("hostPassword").value="";
  dialog.close();await load();
  status(result.provisioning?result.runner.name+" Host Service paired; GitHub runner installation and registration queued. Not ready until Online.":
   result.runner.name+" Host Service paired; GitHub runner setup needs attention: "+(result.provisioningError||"retry from Builders when online."));
 }catch(e){pairStatus(e.message)}
 finally{pairing=false;button.disabled=!$("confirmFingerprint").checked;
  $("backBuilder").disabled=false;$("cancelBuilder").disabled=false;$("closeBuilder").disabled=false;
  $("hostPassword").value="";
 }
});
if(new URLSearchParams(location.search).get("add")==="1")openDialog();
load().catch(e=>status(e.message));
setInterval(()=>{if(!document.hidden&&!dialog.open)load().catch(()=>{});},12000);
