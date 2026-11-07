"use strict";
const $=id=>document.getElementById(id);
let csrf=null;
const themes=["graphite","paper","midnight"];
function theme(id){
 if(!themes.includes(id))id="midnight";
 document.body.dataset.theme=id;
 document.querySelectorAll(".theme-choice").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.palette===id)));
 try{localStorage.setItem("tt-theme",id);}catch{}
}
try{theme(localStorage.getItem("tt-theme")||"midnight");}catch{theme("midnight");}
document.querySelectorAll(".theme-choice").forEach(button=>button.addEventListener("click",()=>theme(button.dataset.palette)));
async function api(path,payload){
 const opts={credentials:"same-origin",cache:"no-store"};
 if(payload!==undefined){
  opts.method="POST";
  opts.headers={"content-type":"application/json","x-tt-csrf":csrf};
  opts.body=JSON.stringify(payload);
 }
 const response=await fetch(path,opts);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"Unable to complete request");
 return result;
}
async function load(){
 try{
  const d=await api("/api/local/overview");
  csrf=d.csrf;$("username").textContent=d.username||"administrator";
  $("githubState").textContent=d.github?.identityConnected&&d.github?.organization?
   "Connected to "+d.github.organization+" as @"+(d.github.login||"GitHub user"):
   d.github?.authorizationExpired?"Authorization expired — reconnect required":
   d.github?.identityConnected?"Account linked, no organization selected":"Not connected";
  await loadRepositoryPreferences();
  $("executionStatus").textContent=(d.jobs?.pending||0)+
   " job(s) awaiting review. Each job requires explicit approval; track progress in Builders & Jobs.";
 }catch(e){$("notice").textContent=e.message;}
}
$("passwordForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const password=$("nextPassword").value;
 if(password!==$("confirmNextPassword").value){$("notice").textContent="New passwords do not match.";return;}
 try{
  await api("/api/local/account/password",{currentPassword:$("currentPassword").value,newPassword:password});
  location.replace("/setup");
 }catch(e){$("notice").textContent=e.message;}
});
$("signout").addEventListener("click",async()=>{
 if(!csrf)return;
 try{await api("/api/local/logout",{});}finally{location.replace("/setup");}
});
load();

async function loadRepositoryPreferences(){
 const preferences=await api("/api/local/github/repository/preferences");
 $("defaultVisibility").value=preferences.defaultVisibility||"private";
 const list=$("repoRequests");list.replaceChildren();
 if(!preferences.requests?.length){const p=document.createElement("p");p.textContent="No repository requests.";list.append(p);return;}
 for(const request of preferences.requests){
  const row=document.createElement("div");row.className="tt-approval-row";
  const detail=document.createElement("div"),label=document.createElement("strong"),meta=document.createElement("small");
  label.textContent=request.organization+"/"+request.name+" · "+request.visibility;
  meta.textContent=request.status+" · "+request.source+" · "+new Date(request.requestedAt).toLocaleString();
  detail.append(label,meta);row.append(detail);
  if(request.status==="pending"){
    const actions=document.createElement("div");actions.className="tt-approval-actions";
    for(const [decision,title] of [["approve","Approve"],["reject","Reject"]]){
      const button=document.createElement("button");button.type="button";button.className="plain-button";button.textContent=title;
      button.addEventListener("click",async()=>{
        const summary=request.organization+"/"+request.name+" ("+request.visibility+")";
        if(!confirm((decision==="approve"?"Create ":"Reject ")+summary+"?"))return;
        button.disabled=true;
        try{
          await api("/api/local/github/repository/requests/decision",{
           requestId:request.id,decision,organization:request.organization,
           name:request.name,visibility:request.visibility});
          $("visibilityNotice").textContent="Request "+decision+"d: "+summary;
          await loadRepositoryPreferences();
        }catch(e){$("visibilityNotice").textContent=e.message;button.disabled=false;}
      });
      actions.append(button);
    }
    row.append(actions);
  }
  if(request.status==="created"&&request.result?.url){
    const a=document.createElement("a");a.href=request.result.url;a.target="_blank";a.rel="noopener noreferrer";
    a.className="quiet-link";a.textContent="Open repository";row.append(a);
  }
  list.append(row);
 }
}
$("visibilityForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const button=event.currentTarget.querySelector("button");button.disabled=true;
 try{
  const result=await api("/api/local/github/repository/preferences",{defaultVisibility:$("defaultVisibility").value});
  $("visibilityNotice").textContent="Default visibility saved: "+result.defaultVisibility+".";
 }catch(e){$("visibilityNotice").textContent=e.message;}
 finally{button.disabled=false;}
});
$("refreshRepoRequests").addEventListener("click",()=>loadRepositoryPreferences().catch(e=>$("visibilityNotice").textContent=e.message));
