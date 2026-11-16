import {ensureRunnerLabel} from "./github_workflow_routing.mjs";
import {releases} from "./marketplace_planning.mjs";

const bad=(message,status=422)=>Object.assign(new Error(message),{status});
const headers=token=>({authorization:"Bearer "+token,accept:"application/vnd.github+json",
 "x-github-api-version":"2022-11-28","user-agent":"Main{Create}"});
const repo="maincreate/main-platform";
const workflowUrl=name=>"https://github.com/"+repo+"/actions/workflows/"+name;
const safeRef=s=>typeof s==="string"&&/^[A-Za-z0-9._/-]{1,80}$/.test(s)&&!s.includes("..");
const safeId=s=>typeof s==="string"&&/^[A-Za-z0-9-]{8,100}$/.test(s);
const slug=s=>String(s).toLowerCase().replaceAll(".","-").replace(/[^a-z0-9-]/g,"-");
const safePart=s=>String(s).replace(/[^A-Za-z0-9-]/g,"-").slice(0,40);

async function dispatch({workflow,inputs,ref,token,fetchImpl=fetch}){
 if(!safeRef(ref))throw bad("Invalid Main{Create} workflow ref");
 const response=await fetchImpl("https://api.github.com/repos/"+repo+"/actions/workflows/"+workflow+"/dispatches",{
  method:"POST",headers:{...headers(token),"content-type":"application/json"},
  body:JSON.stringify({ref,inputs}),signal:AbortSignal.timeout(20000)
 });
 if(response.status!==204)throw bad("GitHub workflow dispatch failed (HTTP "+response.status+"). Check Actions: write permission and that the workflow exists on the selected ref.",response.status===403?403:502);
}
export async function dispatchToolkitInstall({plan,target,builder,organization,token,fetchImpl=fetch,ref=process.env.MAINCREATE_WORKFLOW_REF||"main"}){
 if(!plan||!target||!builder||!organization)throw bad("Installation request is incomplete");
 if(!plan.installable||target.builderId!==builder.id||!builder.managedHost||builder.decommission)
  throw bad("The selected builder is no longer eligible for this toolkit installation",409);
 if(!builder.lastSeen||Date.now()-Date.parse(builder.lastSeen)>120000)throw bad("Builder must be online before toolkit installation",409);
 if(plan.family==="android-sdk"&&!plan.acceptAndroidSdkLicense)throw bad("Google Android SDK license acceptance is required",422);
 const binding=await ensureRunnerLabel({builder,organization,token,fetchImpl});
 const installationId=plan.id.slice(0,8)+"-"+safePart(builder.id)+"-"+Date.now().toString(36);
 await dispatch({workflow:"toolkit-install.yml",ref,token,fetchImpl,inputs:{
  installation_id:installationId,toolkit_family:plan.family,toolkit_version:plan.version,
  runner_label:binding.label,accept_android_sdk_license:plan.acceptAndroidSdkLicense?"true":"false"
 }});
 return {installationId,runnerId:binding.runnerId,runnerName:binding.runnerName,runnerLabel:binding.label,
  workflow:"toolkit-install.yml",workflowUrl:workflowUrl("toolkit-install.yml"),
  workflowRunName:"Main{Create} install / "+installationId+" / "+plan.family+"@"+plan.version,
  requestedAt:new Date().toISOString(),status:"dispatched"};
}
function labelsFor(family,version){
 const release=releases().find(r=>r.family===family&&r.version===version);
 const raw=new Set(["toolkit-"+slug(family)+"-"+slug(version)]);
 for(const label of release?.operations?.build?.runnerLabels||[])raw.add(label);
 for(const profile of release?.deviceProfiles||[])for(const label of profile.runnerLabels||[])raw.add(label);
 if(family==="esp-idf"){
  raw.add("capability-firmware-device-io");
  raw.add("capability-firmware-backup");
  raw.add("capability-firmware-restore");
 }
 if(family==="arduino-cli")raw.add("capability-arduino-cli");
 return [...raw].map(label=>label.startsWith("maincreate-")?label:"maincreate-"+label);
}
async function changeLabels({organization,runnerId,token,add=[],remove=[],fetchImpl=fetch}){
 const base="https://api.github.com/orgs/"+encodeURIComponent(organization)+"/actions/runners/"+runnerId+"/labels";
 if(remove.length){
  const current=await fetchImpl(base,{headers:headers(token),signal:AbortSignal.timeout(15000)});
  if(!current.ok)throw bad("Cannot inspect runner labels (HTTP "+current.status+")",502);
  const body=await current.json().catch(()=>({}));
  for(const name of remove){
   if(!Array.isArray(body.labels)||!body.labels.some(x=>x.name===name))continue;
   const r=await fetchImpl(base+"/"+encodeURIComponent(name),{method:"DELETE",headers:headers(token),signal:AbortSignal.timeout(15000)});
   if(!r.ok&&r.status!==404)throw bad("Cannot remove toolkit runner label "+name+" (HTTP "+r.status+")",502);
  }
 }
 if(add.length){
  const r=await fetchImpl(base,{method:"POST",headers:{...headers(token),"content-type":"application/json"},
   body:JSON.stringify({labels:add}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw bad("Cannot register toolkit capability labels (HTTP "+r.status+")",502);
  const body=await r.json().catch(()=>({}));
  if(!Array.isArray(body.labels)||add.some(name=>!body.labels.some(x=>x.name===name)))
   throw bad("GitHub did not confirm all toolkit capability labels",502);
 }
}
async function workflowRuns(workflow,token,fetchImpl){
 const url="https://api.github.com/repos/"+repo+"/actions/workflows/"+workflow+"/runs?event=workflow_dispatch&branch=main&per_page=100";
 const r=await fetchImpl(url,{headers:headers(token),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw bad("Cannot read GitHub workflow runs (HTTP "+r.status+")",502);
 const body=await r.json();if(!Array.isArray(body.workflow_runs))throw bad("Invalid workflow run inventory",502);
 return body.workflow_runs;
}
const runName=r=>r.run_name||r.display_title||r.name||"";
function statusFor(run){
 if(run.status!=="completed")return "running";
 return run.conclusion==="success"?"completed":run.conclusion==="cancelled"?"cancelled":"failed";
}
export async function refreshMarketplacePlans({plans,organization,token,fetchImpl=fetch}){
 if(!Array.isArray(plans)||!organization||!token)return {plans:plans||[],changed:false};
 let runs;try{runs=await workflowRuns("toolkit-install.yml",token,fetchImpl)}catch{return {plans,changed:false};}
 let changed=false;
 for(const plan of plans){
  for(const target of plan.targets||[]){
   if(!target.installationId||!["dispatched","running"].includes(target.status))continue;
   const run=runs.find(r=>runName(r).includes(target.installationId));
   if(!run)continue;
   const next=statusFor(run);
   if(target.workflowRunId!==run.id||target.status!==next||target.workflowRunUrl!==run.html_url){
    target.workflowRunId=run.id;target.workflowRunUrl=run.html_url;target.workflowStatus=run.status;
    target.workflowConclusion=run.conclusion||null;target.status=next;changed=true;
   }
   if(next==="completed"&&!target.labelsRegistered){
    try{
     await changeLabels({organization,runnerId:target.githubRunnerId,token,add:labelsFor(plan.family,plan.version),fetchImpl});
     target.labelsRegistered=true;target.labelsRegisteredAt=new Date().toISOString();changed=true;
    }catch(e){target.labelError=String(e.message||e).slice(0,300);changed=true;}
   }
   if(next==="failed"||next==="cancelled"){
    target.error="Toolkit installation workflow "+(run.conclusion||next);
    changed=true;
   }
  }
  const statuses=(plan.targets||[]).map(t=>t.status);
  if(statuses.length&&statuses.every(s=>s==="completed"))plan.execution="completed";
  else if(statuses.some(s=>s==="failed"||s==="cancelled"))plan.execution=statuses.some(s=>s==="completed")?"partial":"failed";
  else if(statuses.some(s=>s==="running"||s==="dispatched"))plan.execution="running";
 }
 return {plans,changed};
}
export async function dispatchToolkitCleanup({plan,target,builder,organization,token,fetchImpl=fetch,
 ref=process.env.MAINCREATE_WORKFLOW_REF||"main",confirmCleanup=false}){
 if(!confirmCleanup)throw bad("Explicit cleanup confirmation is required");
 if(!plan||!target||!builder||!organization)throw bad("Cleanup request is incomplete");
 if(target.builderId!==builder.id||target.status!=="completed"||!target.labelsRegistered)
  throw bad("Only a verified installed toolkit version can be cleaned up",409);
 const binding=await ensureRunnerLabel({builder,organization,token,fetchImpl});
 const cleanupId=plan.id.slice(0,8)+"-"+safePart(builder.id)+"-"+Date.now().toString(36);
 await dispatch({workflow:"toolkit-cleanup.yml",ref,token,fetchImpl,inputs:{
  cleanup_id:cleanupId,toolkit_family:plan.family,toolkit_version:plan.version,
  runner_label:binding.label,confirm_cleanup:"true"
 }});
 return {cleanupId,runnerId:binding.runnerId,runnerName:binding.runnerName,runnerLabel:binding.label,
  workflow:"toolkit-cleanup.yml",workflowUrl:workflowUrl("toolkit-cleanup.yml"),
  workflowRunName:"Main{Create} cleanup / "+cleanupId+" / "+plan.family+"@"+plan.version,
  requestedAt:new Date().toISOString(),status:"dispatched"};
}
export async function refreshMarketplaceCleanups({requests,plans,organization,token,fetchImpl=fetch}){
 if(!Array.isArray(requests)||!organization||!token)return {requests:requests||[],changed:false};
 let runs;try{runs=await workflowRuns("toolkit-cleanup.yml",token,fetchImpl)}catch{return {requests,changed:false};}
 let changed=false;
 for(const request of requests){
  if(!request.cleanupId||!["dispatched","running"].includes(request.status))continue;
  const run=runs.find(r=>runName(r).includes(request.cleanupId));if(!run)continue;
  const next=statusFor(run);
  if(request.workflowRunId!==run.id||request.status!==next){
   request.workflowRunId=run.id;request.workflowRunUrl=run.html_url;request.workflowStatus=run.status;
   request.workflowConclusion=run.conclusion||null;request.status=next;changed=true;
  }
  if(next==="completed"&&!request.labelsRemoved){
   const otherFamily=plans.some(p=>p.id!==request.planId&&p.family===request.family&&
    (p.targets||[]).some(t=>t.builderId===request.builderId&&t.status==="completed"&&t.labelsRegistered));
   const otherSameVersion=plans.some(p=>p.id!==request.planId&&p.family===request.family&&p.version===request.version&&
    (p.targets||[]).some(t=>t.builderId===request.builderId&&t.status==="completed"&&t.labelsRegistered));
   const allLabels=labelsFor(request.family,request.version);
   const versionLabel="maincreate-toolkit-"+slug(request.family)+"-"+slug(request.version);
   const remove=[];
   if(!otherSameVersion)remove.push(versionLabel);
   if(!otherFamily)remove.push(...allLabels.filter(label=>label!==versionLabel));
   try{await changeLabels({organization,runnerId:request.githubRunnerId,token,remove,fetchImpl});request.labelsRemoved=true;changed=true;}
   catch(e){request.labelError=String(e.message||e).slice(0,300);changed=true;}
   const plan=plans.find(p=>p.id===request.planId);
   const target=plan?.targets?.find(t=>t.builderId===request.builderId);
   if(target){target.status="cleaned";target.labelsRegistered=false;changed=true;}
  }
  if(next==="failed"||next==="cancelled"){request.error="Toolkit cleanup workflow "+(run.conclusion||next);changed=true;}
 }
 return {requests,changed};
}
