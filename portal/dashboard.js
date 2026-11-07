"use strict";
const $=id=>document.getElementById(id);
const allowed=["graphite","paper","midnight"];
let csrf=null;
function theme(id){
  if(!allowed.includes(id))id="midnight";
  document.body.dataset.theme=id;
  document.querySelectorAll(".theme-choice").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.palette===id)));
  try{localStorage.setItem("tt-theme",id);}catch{}
}
try{theme(localStorage.getItem("tt-theme")||"midnight");}catch{theme("midnight");}
document.querySelectorAll(".theme-choice").forEach(b=>b.addEventListener("click",()=>theme(b.dataset.palette)));
async function load(){
  try{
    const r=await fetch("/api/local/overview",{cache:"no-store",credentials:"same-origin"});
    if(r.status===401){window.location.replace("/setup");return;}
    if(!r.ok)throw Error("Workspace status unavailable");
    const d=await r.json();
    csrf=d.csrf;
    $("username").textContent=d.username||"administrator";
    const connected=!!d.github?.identityConnected;
    const hasOrg=connected&&!!d.github?.organization;
    const expired=!!d.github?.authorizationExpired;
    const card=$("github-card"),status=$("github-status"),action=$("github-action");
    const description=$("github-description"),detail=$("github-detail");
    card.classList.toggle("priority",!hasOrg);
    card.classList.toggle("is-connected",hasOrg);
    action.classList.toggle("action-secondary",hasOrg);
    status.dataset.state=hasOrg?"connected":expired?"attention":connected?"partial":"disconnected";
    if(hasOrg){
      status.textContent="Connected";
      description.textContent="Connected to the "+d.github.organization+" organization.";
      detail.textContent=(d.github.login?"Authorized as @"+d.github.login+". ":"")+"Build runner access is configured separately.";
      action.textContent="Edit GitHub Connection";
    }else if(expired){
      status.textContent="Reconnect required";
      description.textContent="The GitHub authorization expired. Reconnect to continue using your organization.";
      detail.textContent=d.github.savedOrganization?"Previously selected: "+d.github.savedOrganization:"No active GitHub authorization";
      action.textContent="Reconnect GitHub";
    }else if(connected){
      status.textContent="Account linked";
      description.textContent="Signed in to GitHub"+(d.github.login?" as @"+d.github.login:"")+".";
      detail.textContent="Choose an organization to share build machines between repositories.";
      action.textContent="Choose organization";
    }else{
      status.textContent="Not connected";
      description.textContent="Connect your GitHub account and choose an organization. An organization lets build machines serve several repositories.";
      detail.textContent="Recommended next step. A single-repository setup doesn't require an organization.";
      action.textContent="Connect GitHub →";
    }
    const nodes=Number(d.runners?.count||0);
    $("runners-status").textContent=nodes?nodes+" enrolled":"Not connected";
    $("runner-detail").textContent=nodes?nodes+" machine"+(nodes===1?"":"s")+" enrolled. Build execution is not enabled yet.":"No build machines enrolled.";
    $("assistant-status").textContent="Not connected";
    $("connection-count").textContent=Number(connected)+Number(nodes>0)+" of 3 connected";
  }catch(e){$("connection-count").textContent="Connection status unavailable";}
}
$("accountSettings").addEventListener("click",()=>$("accountDialog").showModal());
$("closeAccount").addEventListener("click",()=>$("accountDialog").close());
$("passwordForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("accountError").textContent="";
  const password=$("nextPassword").value;
  if(password!==$("confirmNextPassword").value){$("accountError").textContent="Passwords do not match.";return;}
  try{
    const res=await fetch("/api/local/account/password",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-tt-csrf":csrf},body:JSON.stringify({currentPassword:$("currentPassword").value,newPassword:password})});
    const d=await res.json();
    if(!res.ok)throw Error(d.error||"Unable to change password");
    window.location.replace("/setup");
  }catch(err){$("accountError").textContent=err.message;}
});
$("signout").addEventListener("click",async()=>{
  if(!csrf)return;
  try{await fetch("/api/local/logout",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-tt-csrf":csrf},body:"{}"});}
  finally{window.location.replace("/setup");}
});

load();
