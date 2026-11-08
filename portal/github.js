"use strict";
const $=id=>document.getElementById(id);
let csrf=null,flowActive=false,flowTimer=null;
let previousOrganization="",confirmedForOrganization=null;
function syncRunnerPolicy(){
  const org=$("org").value,valid=/^[A-Za-z0-9-]{1,39}$/.test(org);
  $("runnerPolicy").hidden=!valid;
  $("runnerPolicyConfirmed").checked=org!==""&&confirmedForOrganization===org;
  $("runnerPolicyOrg").textContent=org;
  if(valid)$("runnerPolicyLink").href="https://github.com/organizations/"+encodeURIComponent(org)+"/settings/actions";
  else $("runnerPolicyLink").removeAttribute("href");
  $("saveOrg").disabled=!valid||!$("runnerPolicyConfirmed").checked;
  $("runnerPolicyState").textContent=confirmedForOrganization===org?
    "Operator-confirmed for "+org+". GitHub API verification is not available.":
    "Pending your confirmation. Main{Create} cannot read or change this switch through the supported GitHub API.";
}
const panels=["loading","unavailable","disconnected","authorizing","connected"];
function show(panel){panels.forEach(id=>$(id).hidden=id!==panel);}
function notice(text){$("notice").textContent=text||"";}
async function api(path,values){
  const opts={cache:"no-store",credentials:"same-origin"};
  if(values!==undefined){opts.method="POST";opts.headers={"content-type":"application/json","x-maincreate-csrf":csrf};opts.body=JSON.stringify(values);}
  const response=await fetch(path,opts);
  if(response.status===401){window.location.replace("/setup");throw Error("Sign in required");}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"Could not complete request");
  return data;
}
async function refresh(){
  const [overview,status]=await Promise.all([api("/api/local/overview"),api("/api/local/github/device/status")]);
  csrf=overview.csrf;
  const ready=!!(overview.github?.identityConnected&&overview.github?.organization);
  $("githubStepLabel").textContent=ready?"CONNECTIONS / GITHUB":"SETUP / STEP 2 OF 2";
  $("githubSetupNotice").textContent=ready?"Your GitHub organization is connected. You can switch organizations or update authorization here.":"Connect your GitHub account and select an organization to complete Main{Create} setup.";
  if(status.connected){
    $("githubLogin").textContent=status.login;
    const select=$("org");select.replaceChildren();
    const empty=document.createElement("option");empty.value="";empty.textContent="Choose an organization";select.appendChild(empty);
    for(const org of status.organizations||[]){
      const opt=document.createElement("option");opt.value=org.login;opt.textContent=org.login;
      select.appendChild(opt);
    }
    select.value=status.selectedOrganization||"";
    confirmedForOrganization=status.hostedRunnerPolicyConfirmation?.organization||null;
    previousOrganization=status.selectedOrganization||"";
    syncRunnerPolicy();
    $("orgEmptyHelp").hidden=!!status.organizations?.length;
    $("organizationHint").textContent=status.selectedOrganization?
      "Selected: "+status.selectedOrganization+" (build runner permissions still need setup)":
      (status.organizations?.length?
        "Organizations shown here have installations of this GitHub App that you can access.":
        "No organization installations are visible yet. Install this App into your GitHub organization, then choose Refresh organizations.");
    show("connected");
  }else if(status.available){show("disconnected");}
  else{
    $("githubClientId").value=status.clientId||"";
    show("unavailable");
  }
}
async function poll(seconds){
  if(!flowActive)return;
  flowTimer=setTimeout(async()=>{
    if(!flowActive)return;
    try{
      const data=await api("/api/local/github/device/poll",{});
      if(data.state==="connected"){
        flowActive=false;notice("Connected to GitHub.");await refresh();return;
      }
      poll(Math.max(5,Number(data.retryAfter)||5));
    }catch(e){flowActive=false;notice(e.message);await refresh();}
  },Math.max(5,Number(seconds)||5)*1000);
}
$("githubClientForm").addEventListener("submit",async event=>{
  event.preventDefault();
  notice("");
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const clientId=$("githubClientId").value.trim();
    await api("/api/local/github/device/config",{clientId});
    notice("GitHub App saved. You can now connect.");
    await refresh();
  }catch(error){notice(error.message);}
  finally{submit.disabled=false;}
});
$("refreshOrganizations").addEventListener("click",async()=>{
  notice("");$("refreshOrganizations").disabled=true;
  try{
    const data=await api("/api/local/github/device/installations/refresh",{});
    notice(data.organizations.length?
      "Found "+data.organizations.length+" organization installation(s).":
      "No organization installations yet. Install this GitHub App in an organization, then refresh.");
    await refresh();
  }catch(error){notice(error.message);}
  finally{$("refreshOrganizations").disabled=false;}
});
$("start").addEventListener("click",async()=>{
  notice("");$("start").disabled=true;
  try{
    const data=await api("/api/local/github/device/start",{});
    $("userCode").textContent=data.userCode;
    flowActive=true;show("authorizing");poll(data.interval);
  }catch(e){notice(e.message);$("start").disabled=false;}
});
$("copyCode").addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText($("userCode").textContent);notice("Code copied.");}
  catch{notice("Select and copy the code shown above.");}
});
$("org").addEventListener("change",()=>{confirmedForOrganization=null;syncRunnerPolicy();notice("");});
$("runnerPolicyConfirmed").addEventListener("change",()=>{
  confirmedForOrganization=$("runnerPolicyConfirmed").checked?$("org").value:null;
  syncRunnerPolicy();
});
$("saveOrg").addEventListener("click",async()=>{
  const organization=$("org").value;
  if(!organization){notice("Choose an organization first.");return;}
  if(!$("runnerPolicyConfirmed").checked||confirmedForOrganization!==organization){
    notice("Open GitHub Actions settings and confirm standard hosted runners are disabled for "+organization+".");
    return;
  }
  const button=$("saveOrg");
  button.disabled=true;
  notice("");
  try{
    const saved=await api("/api/local/github/device/organization",{
      organization,standardHostedRunnersDisabledConfirmed:true
    });
    if(saved.organization!==organization||saved.ok!==true)throw new Error("Organization selection could not be confirmed");
    notice("Synchronized "+saved.repositoriesSynced+" repositories. Opening workspace…");
    window.location.assign("/");
  }catch(e){
    notice(e.message);
    button.disabled=false;
  }
});
$("disconnect").addEventListener("click",async()=>{
  try{await api("/api/local/github/device/disconnect",{});notice("GitHub disconnected.");await refresh();}
  catch(e){notice(e.message);}
});
window.addEventListener("pagehide",()=>{flowActive=false;if(flowTimer)clearTimeout(flowTimer);});
refresh().catch(e=>{notice(e.message);show("unavailable");});
