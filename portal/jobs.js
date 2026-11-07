"use strict";
const $=id=>document.getElementById(id);
let csrf=null,selectedPlan=null,capabilities=[],builders=[];
function message(text){$("notification").textContent=text||"";}
try{
 const t=localStorage.getItem("tt-theme");
 if(["graphite","paper","midnight"].includes(t))document.body.dataset.theme=t;
}catch{}
async function api(path,body){
 const req={cache:"no-store",credentials:"same-origin"};
 if(body!==undefined){
  req.method="POST";req.headers={"content-type":"application/json","x-tt-csrf":csrf};
  req.body=JSON.stringify(body);
 }
 const r=await fetch(path,req);
 if(r.status===401){location.replace("/setup");throw new Error("Sign in required");}
 const v=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(v.error||"Request failed");
 return v;
}
const fabric=(tool,args={})=>api("/api/local/fabric",{tool,arguments:args});
function el(tag,text,cls){
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 if(cls)node.className=cls;
 return node;
}
function button(label,handler){
 const b=el("button",label,"plain-button");b.type="button";
 b.addEventListener("click",async()=>{
  b.disabled=true;
  try{await handler();}catch(e){message(e.message);}finally{b.disabled=false;}
 });
 return b;
}
function renderBuilders(){
 const list=$("runners-list"),select=$("runner");
 list.replaceChildren();select.replaceChildren();
 if(!builders.length){list.append(el("p","No machines enrolled yet."));}
 for(const runner of builders){
  const entry=el("div",undefined,"runner-entry"),left=el("div"),right=el("small",runner.online?"Recent heartbeat":"Not recently seen");
  left.append(el("strong",runner.name),el("small",runner.os+" / "+runner.arch+" · "+runner.id.slice(0,12)));
  entry.append(left,right);list.append(entry);
  const opt=el("option",runner.name+" ("+runner.os+")");
  opt.value=runner.id;select.append(opt);
 }
 if(!builders.length){const opt=el("option","Enroll a machine first");opt.value="";select.append(opt);}
}
function renderCapabilities(){
 const select=$("capability");select.replaceChildren();
 for(const cap of capabilities){
  const opt=el("option",cap.id+" · "+cap.risk+(cap.state!=="available"?" (not available)":""));
  opt.value=cap.id;opt.disabled=cap.state!=="available";select.append(opt);
 }
 const available=capabilities.find(c=>c.state==="available");
 if(available)select.value=available.id;
}
async function fetchJobs(){
 const [all,files]=await Promise.all([fabric("tt_jobs",{action:"list"}),fabric("tt_assets",{action:"list"})]);
 renderJobs(all.jobs||[],files.assets||[]);
}
function renderJobs(jobs,assets){
 const holder=$("jobs-list");holder.replaceChildren();
 if(!jobs.length){holder.append(el("p","No jobs created. Plan an operation to begin."));return;}
 for(const j of jobs){
  const entry=el("article",undefined,"job-entry"),head=el("div",undefined,"job-title");
  head.append(el("strong",j.capability+" · "+j.id.slice(0,8)));
  const status=el("span",j.status.replaceAll("_"," "),"job-status");status.dataset.status=j.status;
  head.append(status);entry.append(head);
  entry.append(el("div","Machine "+j.runner_id.slice(0,12)+" · "+(j.created_at||"").replace("T"," ").slice(0,19),"job-meta"));
  const actions=el("div",undefined,"job-actions");
  if(j.status==="awaiting_approval"){
   actions.append(button("Approve this job",async()=>{
    await api("/api/local/jobs/approval",{job_id:j.id,decision:"approve"});
    message("Job approved. It will run only if execution is enabled and this machine polls for it.");
    await fetchJobs();
   }));
   actions.append(button("Reject",async()=>{
    await api("/api/local/jobs/approval",{job_id:j.id,decision:"reject"});
    message("Job rejected.");await fetchJobs();
   }));
  }
  if(["awaiting_approval","queued"].includes(j.status)){
   actions.append(button("Cancel",async()=>{
    await fabric("tt_jobs",{action:"cancel",job_id:j.id});await fetchJobs();
   }));
  }
  if(actions.children.length)entry.append(actions);
  const details=el("details"),summary=el("summary","Steps and logs");
  details.append(summary,el("pre",JSON.stringify(j.steps||[],null,2)+(j.logs?"\n\n"+j.logs:"\nNo logs available.")));
  entry.append(details);
  for(const a of assets.filter(x=>x.job_id===j.id&&x.complete)){
   entry.append(button("Download "+a.name+" ("+Math.ceil(a.size/1024)+" KiB)",()=>download(a)));
  }
  holder.append(entry);
 }
}
async function download(asset){
 const chunks=[];let offset=0;
 while(offset<asset.size){
  const d=await fabric("tt_assets",{action:"get",asset_id:asset.id,offset,length:48*1024});
  const binary=atob(d.content_base64),part=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)part[i]=binary.charCodeAt(i);
  chunks.push(part);offset=d.next_offset;
  if(!binary.length)throw new Error("Asset response ended early");
 }
 const blob=new Blob(chunks,{type:asset.mime||"application/octet-stream"}),url=URL.createObjectURL(blob);
 const link=document.createElement("a");link.href=url;link.download=asset.name;
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function refreshAll(){
 const overview=await api("/api/local/overview");csrf=overview.csrf;
 $("username").textContent=overview.username||"administrator";
 const d=await fabric("tt_discover",{resource:"all"});
 builders=d.runners||[];capabilities=d.capabilities||[];
 renderBuilders();renderCapabilities();
 if(overview.runners?.executionEnabled===false){
  message("Execution is disabled on this controller until the operator enables TT_ENABLE_FABRIC_EXECUTION=1. Plans and approvals remain available.");
 }
 await fetchJobs();
}
$("refresh").addEventListener("click",()=>refreshAll().catch(e=>message(e.message)));
$("refreshJobs").addEventListener("click",()=>fetchJobs().catch(e=>message(e.message)));
$("invite").addEventListener("click",async()=>{
 $("invite").disabled=true;
 try{
  const invitation=await api("/api/local/runners/invite",{});
  $("enrollCommand").textContent="TT_CONTROLLER_URL='"+location.origin+"' TT_ENROLLMENT_TOKEN='"+invitation.token+"' node runner/agent.mjs enroll";
  $("enrollment").hidden=false;
  message("Pairing credential generated. It is only displayed once and expires in 10 minutes.");
 }catch(e){message(e.message);}finally{$("invite").disabled=false;}
});
$("planForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const cap=$("capability").value,runner=$("runner").value;
 if(!runner)return message("Enroll a machine first.");
 const parameters={};
 if(cap.includes("esp_idf")){
  if(!$("repository").value.trim())return message("Repository is required for ESP-IDF operations.");
  parameters.repository=$("repository").value.trim();
  if($("revision").value.trim())parameters.revision=$("revision").value.trim();
 }
 try{
  selectedPlan=await fabric("tt_plan",{capability:cap,runner_id:runner,parameters});
  $("planPreview").textContent=JSON.stringify(selectedPlan,null,2);
  $("planResult").hidden=false;
  message("Plan created. Requesting a job does not execute it until you approve the job separately.");
 }catch(e){message(e.message);}
});
$("requestExecution").addEventListener("click",async()=>{
 if(!selectedPlan)return;
 $("requestExecution").disabled=true;
 try{
  const result=await fabric("tt_execute",{plan_id:selectedPlan.plan_id});
  message("Job "+result.job.id.slice(0,8)+" created; explicit administrator approval required.");
  $("planResult").hidden=true;selectedPlan=null;await fetchJobs();
 }catch(e){message(e.message);}finally{$("requestExecution").disabled=false;}
});
refreshAll().catch(e=>message(e.message));
