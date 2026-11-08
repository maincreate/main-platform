"use strict";
const $=id=>document.getElementById(id);
let csrf=null,currentJobs=[],currentAssets=[],devices=[];
try{const theme=localStorage.getItem("tt-theme");if(["graphite","paper","midnight"].includes(theme))document.body.dataset.theme=theme;}catch{}
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function message(value){$("notification").textContent=value||"";}
async function api(path,payload){
 const req={credentials:"same-origin",cache:"no-store"};
 if(payload!==undefined){req.method="POST";req.headers={"content-type":"application/json","x-tt-csrf":csrf};req.body=JSON.stringify(payload);}
 const response=await fetch(path,req);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"Request failed");
 return data;
}
const fabric=(tool,args={})=>api("/api/local/fabric",{tool,arguments:args});
function action(label,fn){
 const button=el("button",label,"plain-button");button.type="button";
 button.addEventListener("click",async()=>{button.disabled=true;try{await fn();}catch(e){message(e.message);}finally{button.disabled=false;}});
 return button;
}
function td(row,text,cls){const node=el("td",text,cls);row.append(node);return node;}
function showFlash(job){
 const dialog=$("flashDialog"),select=$("flashDevice");
 select.replaceChildren();
 const assets=currentAssets.filter(a=>a.job_id===job.id&&a.complete);
 $("flashJobDetails").textContent=(job.repository?"GitHub Actions":"Local build")+" · "+String(job.id).slice(0,12)+" · "+(job.capability||job.name||"Build")+" · "+assets.length+" verified local artifact(s)";
 const available=devices.filter(d=>d.lifecycle==="connected");
 if(!available.length){const option=el("option","No connected devices");option.value="";select.append(option);}
 for(const device of available){const option=el("option",(device.label||device.product||device.description||"Device")+" · "+(device.runnerName||"builder")+" · "+device.port);option.value=device.id;select.append(option);}
 $("requestFlash").disabled=true;
 $("flashExplanation").textContent=assets.length===0?"This job has no completed firmware artifact. Flashing is unavailable.":"Flash requests need a validated firmware-to-device compatibility adapter and an approval API. Neither is enabled yet; no device will be modified.";
 dialog.showModal();
}
function render(){
 const holder=$("jobs-list");holder.replaceChildren();
 const query=$("localJobSearch").value.toLowerCase().trim(),status=$("localJobStatus").value;
 const matching=currentJobs.filter(j=>(!query||[j.capability,j.id,j.runner_id,j.status].join(" ").toLowerCase().includes(query))&&
 (status==="all"||j.status===status));
 if(!matching.length){holder.append(el("p","No matching local jobs. GitHub Actions workflow history will appear when that integration is available."));return;}
 const table=el("table",undefined,"tt-jobs-table"),thead=el("thead"),hdr=el("tr");
 for(const h of ["Job","Status","Builder","Started","Actions"])hdr.append(el("th",h));
 thead.append(hdr);table.append(thead);
 const tbody=el("tbody");
 for(const j of matching){
  const row=el("tr");
  const jobCell=td(row,j.capability||"Job");jobCell.append(el("div",j.id.slice(0,12),"tt-job-meta"));
  const state=td(row,"");state.append(el("span",String(j.status).replaceAll("_"," "),"job-status"));
  td(row,j.runner_id?.slice(0,12)||"—");
  td(row,j.created_at?new Date(j.created_at).toLocaleString():"—");
  const controls=td(row,"","tt-job-actions");
  const buttons=el("div",undefined,"tt-job-actions");
  const details=el("tr"),detailCell=td(details,"","tt-job-details");detailCell.colSpan=5;details.hidden=true;
  const artifactList=currentAssets.filter(a=>a.job_id===j.id&&a.complete);
  const header=el("div","Steps and logs");detailCell.append(header,el("pre",JSON.stringify(j.steps||[],null,2)+(j.logs?"\n\n"+j.logs:"\nNo logs available.")));
  for(const a of artifactList)detailCell.append(action("Download "+a.name,()=>download(a)));
  buttons.append(action("Details",()=>{details.hidden=!details.hidden;}));
  if(new URLSearchParams(location.search).get("job")===j.id)details.hidden=false;
  if(j.status==="completed")buttons.append(action("Flash device",()=>showFlash(j)));
  if(j.status==="awaiting_approval"){
   buttons.append(action("Approve",async()=>{await api("/api/local/jobs/approval",{job_id:j.id,decision:"approve"});await load();}));
   buttons.append(action("Reject",async()=>{await api("/api/local/jobs/approval",{job_id:j.id,decision:"reject"});await load();}));
  }
  if(["awaiting_approval","queued"].includes(j.status))buttons.append(action("Cancel",async()=>{await fabric("tt_jobs",{action:"cancel",job_id:j.id});await load();}));
  controls.append(buttons);tbody.append(row,details);
 }
 table.append(tbody);holder.append(table);
}
async function download(asset){
 const chunks=[];let offset=0;
 while(offset<asset.size){
  const chunk=await fabric("tt_assets",{action:"get",asset_id:asset.id,offset,length:48*1024});
  const binary=atob(chunk.content_base64),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  chunks.push(bytes);offset=chunk.next_offset;
  if(!binary.length)throw Error("Artifact download ended early");
 }
 const blob=new Blob(chunks,{type:asset.mime||"application/octet-stream"}),url=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=url;a.download=asset.name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function load(){
 $("refreshJobs").disabled=true;
 try{
  const overview=await api("/api/local/overview");csrf=overview.csrf;
  $("username").textContent=overview.username||"administrator";
  const results=await Promise.all([fabric("tt_jobs",{action:"list"}),fabric("tt_assets",{action:"list"}),api("/api/local/devices?mode=visible")]);
  currentJobs=results[0].jobs||[];currentAssets=results[1].assets||[];devices=results[2].devices||[];
   const requested=new URLSearchParams(location.search).get("job");
   if(requested){
    const job=currentJobs.find(j=>j.id===requested);
    if(job){$("localJobSearch").value=requested;render();}
   }
  render();message("");
 }catch(e){message(e.message);}finally{$("refreshJobs").disabled=false;}
}
$("localJobSearch").addEventListener("input",render);
$("localJobStatus").addEventListener("change",render);
$("refreshJobs").addEventListener("click",load);
window.openGitHubFlash=showFlash;
$("closeFlash").addEventListener("click",()=>$("flashDialog").close());
load();
