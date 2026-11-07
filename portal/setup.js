"use strict";
const $=id=>document.getElementById(id);
try {
  const chosen=localStorage.getItem("tt-theme");
  if(["graphite","paper","midnight"].includes(chosen))document.body.dataset.theme=chosen;
} catch {}
const notice=msg=>{$("notice").textContent=msg;};
async function api(path,data){
  const init={cache:"no-store",credentials:"same-origin"};
  if(data!==undefined){init.method="POST";init.headers={"content-type":"application/json"};init.body=JSON.stringify(data);}
  const r=await fetch(path,init);let result={};
  try{result=await r.json();}catch{}
  if(!r.ok)throw new Error(result.error||"Request failed ("+r.status+")");
  return result;
}
async function init(){
  try{
    const [account,current]=await Promise.all([api("/api/local/public"),api("/api/local/session")]);
    if(current.authenticated){window.location.replace("/");return;}
    $("firstRun").hidden=!!account.claimed;
    $("login").hidden=!account.claimed;
  }catch(err){notice(err.message)}
  finally{$("loading").hidden=true;}
}
async function submit(event,path,fields){
  event.preventDefault();notice("");
  const button=event.currentTarget.querySelector("button[type=submit]");
  button.disabled=true;
  try{
    await api(path,fields());
    window.location.replace("/");
  }catch(err){notice(err.message);button.disabled=false;}
}
$("firstRunForm").addEventListener("submit",e=>submit(e,"/api/local/bootstrap",()=>{
  const password=$("newPassword").value;
  if(password!==$("confirmPassword").value)throw Error("Passwords do not match");
  return {username:$("newUsername").value.trim(),password};
}));
$("loginForm").addEventListener("submit",e=>submit(e,"/api/local/login",()=>({
  username:$("loginUsername").value.trim(),password:$("loginPassword").value
})));
init();
