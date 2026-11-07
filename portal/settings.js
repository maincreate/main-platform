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
