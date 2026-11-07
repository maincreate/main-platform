"use strict";
const $=id=>document.getElementById(id);
const allowed=["graphite","paper","midnight"];
let csrf=null;
function theme(id){
  if(!allowed.includes(id))id="graphite";
  document.body.dataset.theme=id;
  document.querySelectorAll(".theme-choice").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.palette===id)));
  try{localStorage.setItem("tt-theme",id);}catch{}
}
try{theme(localStorage.getItem("tt-theme")||"graphite");}catch{theme("graphite");}
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
    const hasOrg=!!d.github?.organization;
    $("github-status").textContent=hasOrg?"Organization selected":connected?"GitHub connected":"Not connected";
    const nodes=Number(d.runners?.count||0);
    $("runners-status").textContent=nodes?nodes+" enrolled":"Not connected";
    $("runner-detail").textContent=nodes?nodes+" machine"+(nodes===1?"":"s")+" enrolled. Build execution is not enabled yet.":"No build machines enrolled.";
    $("assistant-status").textContent="Not connected";
    $("connection-count").textContent=Number(connected)+Number(nodes>0)+" of 3 connected";
  }catch(e){$("connection-count").textContent="Connection status unavailable";}
}
$("signout").addEventListener("click",async()=>{
  if(!csrf)return;
  try{await fetch("/api/local/logout",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-tt-csrf":csrf},body:"{}"});}
  finally{window.location.replace("/setup");}
});
load();
