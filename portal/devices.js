"use strict";
const $=id=>document.getElementById(id);
let csrf=null,inventory=[];
try{const t=localStorage.getItem("tt-theme");if(["midnight","graphite","paper"].includes(t))document.body.dataset.theme=t;}catch{}
async function api(path,payload){
 const options={credentials:"same-origin",cache:"no-store"};
 if(payload!==undefined){options.method="POST";options.headers={"content-type":"application/json","x-tt-csrf":csrf};options.body=JSON.stringify(payload);}
 const response=await fetch(path,options);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"Failed to read device inventory");
 return data;
}
function node(tag,value,cls){
 const n=document.createElement(tag);
 if(value!==undefined)n.textContent=value;
 if(cls)n.className=cls;return n;
}
function hex(n){return typeof n==="number"?n.toString(16).padStart(4,"0").toUpperCase():"—";}
function date(s){return s?new Date(s).toLocaleString():"Never";}
function render(data){
 inventory=data.devices||[];
 const select=$("deviceHost"),selected=select.value;select.replaceChildren();
 const all=node("option","All builders");all.value="all";select.append(all);
 for(const host of [...new Set(inventory.map(d=>d.runnerName||d.runnerId).filter(Boolean))].sort()){
  const opt=node("option",host);opt.value=host;select.append(opt);
 }
 select.value=[...select.options].some(x=>x.value===selected)?selected:"all";
 renderInventory(data);
}
let lastSummary={};
function renderInventory(data){
 lastSummary=data.summary||lastSummary;
 const rows=$("deviceRows");rows.replaceChildren();
 const summary=lastSummary;
 $("totals").textContent=(summary.connected||0)+" connected · "+(summary.offline||0)+" recent offline · "+
  (summary.hidden||0)+" hidden · "+(summary.archived||0)+" archived";
 const query=$("deviceSearch").value.toLowerCase().trim(),host=$("deviceHost").value;
 const shown=inventory.filter(item=>(host==="all"||(item.runnerName||item.runnerId)===host)&&(!query||[item.label,item.description,item.product,item.manufacturer,item.runnerName,item.port,item.serialNumber].join(" ").toLowerCase().includes(query)));
 if(!shown.length){
  const tr=node("tr"),td=node("td","");
  td.colSpan=7;tr.append(td);rows.append(tr);return;
 }
 for(const d of shown){
  const tr=node("tr");
  const name=node("td"),first=node("strong",d.label||d.product||d.description||"USB serial device");
  const meta=node("small",hex(d.vid)+":"+hex(d.pid)+(d.manufacturer?" · "+d.manufacturer:""));
  name.append(first,meta);tr.append(name);
  tr.append(node("td",d.runnerName||d.runnerId));
  tr.append(node("td",d.port||"—"));
  const identity=node("td"),label=node("strong",d.identityConfidence==="serial"?"Serial identified":
   d.identityConfidence==="location"?"USB location":"Port identity only");
  identity.append(label,node("small",d.serialNumber||d.location||"No hardware serial"));
  tr.append(identity);
  tr.append(node("td",date(d.lastSeen)));
  const statusTd=node("td"),status=node("span",d.lifecycle==="connected"?"Connected":d.lifecycle,"inventory-badge");
  status.dataset.state=d.lifecycle;statusTd.append(status);tr.append(statusTd);
  const actionTd=node("td"),edit=node("button","Rename","plain-button");edit.type="button";
  edit.addEventListener("click",async()=>{
   const value=prompt("Device label (blank to clear):",d.label||"");
   if(value===null)return;
   edit.disabled=true;
   try{await api("/api/local/devices/label",{device_id:d.id,label:value.trim()});await load();}
   catch(e){$("notice").textContent=e.message;}finally{edit.disabled=false;}
  });
  actionTd.append(edit);tr.append(actionTd);
  rows.append(tr);
 }
}
async function load(){
 $("refresh").disabled=true;
 try{
  if(!csrf){
   const overview=await api("/api/local/overview");
   csrf=overview.csrf;$("username").textContent=overview.username||"administrator";
  }
  render(await api("/api/local/devices?mode="+($("showHidden").checked?"all":"visible")));
  $("notice").textContent="";
 }catch(e){$("notice").textContent=e.message;}
 finally{$("refresh").disabled=false;}
}
$("showHidden").addEventListener("change",load);
$("refresh").addEventListener("click",load);
load();
 
$("deviceSearch").addEventListener("input",()=>renderInventory({}));
$("deviceHost").addEventListener("change",()=>renderInventory({}));
