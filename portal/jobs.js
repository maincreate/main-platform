"use strict";
const $=id=>document.getElementById(id);
let csrf=null,currentJobs=[],currentAssets=[],devices=[];
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function message(value){$("notification").textContent=value||"";}
async function api(path,payload){
 const req={credentials:"same-origin",cache:"no-store"};
 if(payload!==undefined){req.method="POST";req.headers={"content-type":"application/json","x-maincreate-csrf":csrf};req.body=JSON.stringify(payload);}
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
let selectedFirmwareJob=null,flashPreflight=null,pendingFlashApproval=null;
const newestJob=(capability,runnerId)=>currentJobs.find(j=>j.status==="completed"&&
 j.capability===capability&&j.runner_id===runnerId);
async function readJobJSON(job,name){
 if(!job)return null;
 const artifact=currentAssets.find(a=>a.job_id===job.id&&a.name===name&&a.complete);
 if(!artifact||artifact.size>48*1024)return null;
 const data=await fabric("maincreate_assets",{action:"get",asset_id:artifact.id,offset:0,length:artifact.size});
 if(!data.complete)return null;
 try{return JSON.parse(atob(data.content_base64));}catch{return null;}
}
async function checkFlashReadiness(){
 const selected=devices.find(d=>d.id===$("flashDevice").value&&d.lifecycle==="connected");
 flashPreflight=null;$("requestFlash").disabled=true;
 if(!selected){$("flashExplanation").textContent="No connected target device is selected.";return;}
 if(selectedFirmwareJob?.capability!=="firmware.esp_idf.smoke_build"||
  !currentAssets.some(a=>a.job_id===selectedFirmwareJob.id&&a.name==="esp32s3-firmware-manifest.json"&&a.complete)){
  $("flashExplanation").textContent="Select a completed, verified ESP-IDF ESP32-S3 firmware build.";return;
 }
 const probes=currentJobs.filter(j=>j.capability==="firmware.esp_idf.probe"&&j.status==="completed"&&j.runner_id===selected.runnerId);
 let identity=null;
 for(const j of probes){const x=await readJobJSON(j,"esp32-device-probe.json");
  if(x?.port===selected.port&&x.chip==="ESP32-S3"&&x.flash_size==="16MB"&&
   /^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/.test(x.mac||"")){identity=x;break;}
 }
 if(!identity){$("flashExplanation").textContent="This device needs a completed active ESP32-S3 identity probe first.";return;}
 const backups=currentJobs.filter(j=>j.capability==="firmware.esp_idf.backup"&&j.status==="completed"&&j.runner_id===selected.runnerId);
 let backup=null;
 for(const j of backups){const x=await readJobJSON(j,"esp32s3-backup-manifest.json");
  if(x?.mac===identity.mac&&x.port===selected.port&&x.flash_size==="16MB"&&
   /^[a-f0-9]{64}$/.test(x.full_sha256||"")&&x.parts?.length===4){backup=j;break;}
 }
 if(!backup){$("flashExplanation").textContent="No completed 16 MB recovery backup matches this exact ESP32-S3.";return;}
 const inspections=currentJobs.filter(j=>j.capability==="firmware.esp_idf.security_preflight"&&j.status==="completed"&&j.runner_id===selected.runnerId);
 let security=null;
 for(const j of inspections){const x=await readJobJSON(j,"esp32-security-info.json");
  if(x?.mac===identity.mac&&x.port===selected.port&&x.chip==="ESP32-S3"&&
   /Secure Boot:\s*Disabled/.test(x.raw_security_info||"")&&
   /Flash Encryption:\s*Disabled/.test(x.raw_security_info||"")){security=j;break;}
 }
 if(!security){$("flashExplanation").textContent="A completed disabled-security inspection for this device is required.";return;}
 flashPreflight={port:selected.port,expected_mac:identity.mac,source_job_id:selectedFirmwareJob.id,
  backup_job_id:backup.id,security_job_id:security.id,runner_id:selected.runnerId};
 $("flashExplanation").textContent="ESP32-S3 "+identity.mac+" · 16 MB · complete recovery backup "+
  backup.id.slice(0,8)+" · security preflight "+security.id.slice(0,8)+". Requesting requires a separate administrator approval.";
 $("requestFlash").disabled=false;
}
async function showFlash(job){
 const dialog=$("flashDialog"),select=$("flashDevice");selectedFirmwareJob=job;flashPreflight=null;
 select.replaceChildren();
 const assets=currentAssets.filter(a=>a.job_id===job.id&&a.complete);
 $("flashJobDetails").textContent="Verified ESP-IDF source job "+job.id.slice(0,12)+" · "+assets.length+" artifact(s)";
 const available=devices.filter(d=>d.lifecycle==="connected");
 if(!available.length){const option=el("option","No connected devices");option.value="";select.append(option);}
 for(const device of available){
  const option=el("option",(device.label||device.product||device.description||"Device")+" · "+
   (device.runnerName||"builder")+" · "+device.port);option.value=device.id;select.append(option);
 }
 $("requestFlash").disabled=true;$("flashExplanation").textContent="Checking device, complete backup and security evidence…";
 dialog.showModal();await checkFlashReadiness();
}
async function showFlashApproval(job){
 pendingFlashApproval=job;
 $("confirmFlashMAC").value="";$("flashAdminPassword").value="";
 $("flashApproveDetails").textContent="Target MAC: "+(job.target_mac||"unknown")+
  " · Job "+job.id.slice(0,12)+". This write may replace the device's current application.";
 $("flashApproveDialog").showModal();
}
function render(){
 const holder=$("jobs-list");holder.replaceChildren();
 const query=$("localJobSearch").value.toLowerCase().trim(),status=$("localJobStatus").value;
 const matching=currentJobs.filter(j=>(!query||[j.capability,j.id,j.runner_id,j.status].join(" ").toLowerCase().includes(query))&&
 (status==="all"||j.status===status));
 if(!matching.length){holder.append(el("p","No matching local jobs. GitHub Actions workflow history will appear when that integration is available."));return;}
 const table=el("table",undefined,"maincreate-jobs-table"),thead=el("thead"),hdr=el("tr");
 for(const h of ["Job","Status","Builder","Started","Actions"])hdr.append(el("th",h));
 thead.append(hdr);table.append(thead);
 const tbody=el("tbody");
 for(const j of matching){
  const row=el("tr");
  const jobCell=td(row,j.capability||"Job");jobCell.append(el("div",j.id.slice(0,12),"maincreate-job-meta"));
  const state=td(row,"");state.append(el("span",String(j.status).replaceAll("_"," "),"job-status"));
  td(row,j.runner_id?.slice(0,12)||"—");
  td(row,j.created_at?new Date(j.created_at).toLocaleString():"—");
  const controls=td(row,"","maincreate-job-actions");
  const buttons=el("div",undefined,"maincreate-job-actions");
  const details=el("tr"),detailCell=td(details,"","maincreate-job-details");detailCell.colSpan=5;details.hidden=true;
  const artifactList=currentAssets.filter(a=>a.job_id===j.id&&a.complete);
  const header=el("div","Steps and logs");detailCell.append(header,el("pre",JSON.stringify(j.steps||[],null,2)+(j.logs?"\n\n"+j.logs:"\nNo logs available.")));
  for(const a of artifactList)detailCell.append(action("Download "+a.name,()=>download(a)));
  buttons.append(action("Details",()=>{details.hidden=!details.hidden;}));
  if(new URLSearchParams(location.search).get("job")===j.id)details.hidden=false;
  if(j.status==="completed"&&j.capability==="firmware.esp_idf.smoke_build")buttons.append(action("Flash device",()=>showFlash(j)));
  if(j.status==="awaiting_approval"){
   buttons.append(action("Approve",async()=>{if(j.capability==="firmware.esp_idf.flash")return showFlashApproval(j);await api("/api/local/jobs/approval",{job_id:j.id,decision:"approve"});await load();}));
   buttons.append(action("Reject",async()=>{await api("/api/local/jobs/approval",{job_id:j.id,decision:"reject"});await load();}));
  }
  if(["awaiting_approval","queued"].includes(j.status))buttons.append(action("Cancel",async()=>{await fabric("maincreate_jobs",{action:"cancel",job_id:j.id});await load();}));
  controls.append(buttons);tbody.append(row,details);
 }
 table.append(tbody);holder.append(table);
}
async function download(asset){
 const chunks=[];let offset=0;
 while(offset<asset.size){
  const chunk=await fabric("maincreate_assets",{action:"get",asset_id:asset.id,offset,length:48*1024});
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
  const results=await Promise.all([fabric("maincreate_jobs",{action:"list"}),fabric("maincreate_assets",{action:"list"}),api("/api/local/devices?mode=visible")]);
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
$("flashDevice").addEventListener("change",()=>checkFlashReadiness().catch(e=>message(e.message)));
$("requestFlash").addEventListener("click",async()=>{
 if(!flashPreflight)return;
 const button=$("requestFlash");button.disabled=true;
 try{
  const {runner_id,...parameters}=flashPreflight;
  const plan=await fabric("maincreate_plan",{capability:"firmware.esp_idf.flash",runner_id,parameters});
  const result=await fabric("maincreate_execute",{plan_id:plan.plan_id});
  if(result.job?.status!=="awaiting_approval")throw Error("Flash job did not enter the required approval state");
  $("flashDialog").close();await load();message("Flash job "+result.job.id.slice(0,12)+" is awaiting administrator approval. No firmware has been written.");
 }catch(e){message(e.message);}finally{button.disabled=false;}
});
$("cancelFlashApprove").addEventListener("click",()=>{$("flashAdminPassword").value="";$("flashApproveDialog").close();});
$("approveFlashWrite").addEventListener("click",async()=>{
 if(!pendingFlashApproval)return;
 const button=$("approveFlashWrite");button.disabled=true;
 try{
  await api("/api/local/jobs/approval",{job_id:pendingFlashApproval.id,decision:"approve",
   confirm_mac:$("confirmFlashMAC").value.trim(),password:$("flashAdminPassword").value});
  $("flashAdminPassword").value="";$("flashApproveDialog").close();await load();
  message("Approved device write queued. Keep the ESP32 powered and connected.");
 }catch(e){message(e.message);}finally{button.disabled=false;}
});
$("closeFlash").addEventListener("click",()=>$("flashDialog").close());
load();
