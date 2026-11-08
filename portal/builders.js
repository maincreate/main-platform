"use strict";
const $=id=>document.getElementById(id);
let csrf=null,builders=[],githubRunners=[],fingerprint=null,operation=null;
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
 for(const name of ["Machine","Platform","Connection","Toolchains and packages","Labels"])head.append(el("th",name));
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
  tr.append(tools,el("td",(r.labels||[]).join(", ")||"—"));tbody.append(tr);
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
}
function openDialog(){
 $("controllerAddress").textContent=location.origin;
 $("addBuilderDialog").showModal();
}
$("addBuilder").addEventListener("click",openDialog);
$("cancelBuilder").addEventListener("click",()=>$("addBuilderDialog").close());
$("refresh").addEventListener("click",()=>load().catch(e=>status(e.message)));
$("builderSearch").addEventListener("input",renderBuilders);
$("builderStatus").addEventListener("change",renderBuilders);
if(new URLSearchParams(location.search).get("add")==="1")openDialog();
load().catch(e=>status(e.message));
