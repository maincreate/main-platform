"use strict";
const $=id=>document.getElementById(id);
let csrf=null,selectedOrg=null,projectInventory=[],projectUpdatedAt=null,projectTruncated=false;
let routes=[],builders=[],devices=[],sdkReleases=[],activeRouteRepo=null;
async function api(path,payload){
 const options={credentials:"same-origin",cache:"no-store"};
 if(payload!==undefined){options.method="POST";options.headers={"content-type":"application/json","x-maincreate-csrf":csrf};options.body=JSON.stringify(payload);}
 const response=await fetch(path,options);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"GitHub repository synchronization failed");
 return data;
}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function render(result){
 projectInventory=result.repositories||[];projectUpdatedAt=result.updatedAt;projectTruncated=!!result.truncated;
 const pending=projectInventory.filter(p=>p.alert).length;
 const unknown=projectInventory.filter(p=>p.compatibility?.status==="unknown"&&!p.ignored&&!p.archived).length;
 $("compatibilitySummary").textContent=pending?
   pending+" project"+(pending===1?" needs":"s need")+" a compatible builder · "+unknown+" not yet classified":
   "No confirmed unmatched active projects · "+unknown+" awaiting requirement detection";
 renderProjectList();
}
function renderProjectList(){
 const result={repositories:projectInventory,organization:selectedOrg,updatedAt:projectUpdatedAt,truncated:projectTruncated};
 $("organization").textContent=result.organization?result.organization+" repositories":"GitHub repositories";
 $("syncStatus").textContent=result.updatedAt?
  "Last synchronized "+new Date(result.updatedAt).toLocaleString()+(result.truncated?" · first 500 repositories only":""):
  result.organization?"Not synchronized yet. Sync to retrieve your installed repositories.":"Connect an organization in Settings first.";
 const holder=$("projectRows");holder.replaceChildren();
 if(!result.repositories?.length){
  const empty=node("div",result.organization?"No repositories in the current inventory.":"GitHub organization not connected.","home-empty");
  const link=node("a",result.organization?"Sync GitHub repositories":"Open connection settings","quiet-link");
  link.href=result.organization?"/projects":"/settings";empty.append(link);holder.append(empty);return;
 }
 const query=$("projectSearch").value.toLowerCase().trim(),filter=$("projectFilter").value;
 const items=result.repositories.filter(item=>(!query||[item.fullName,item.description,item.defaultBranch].join(" ").toLowerCase().includes(query))&&
  (filter==="all"||(filter==="active"&&!item.archived)||(filter==="archived"&&item.archived)||(filter==="private"&&item.private)||(filter==="public"&&!item.private)||(filter==="missing"&&item.alert)||(filter==="unknown"&&item.compatibility?.status==="unknown")||(filter==="ignored"&&item.ignored)));
 if(!items.length){holder.append(node("p","No matching repositories.","home-empty"));return;}
 for(const project of items){
  const card=node("article",undefined,"project-entry"),left=node("div"),right=node("div",undefined,"project-right");
  const name=node("strong",project.fullName),description=node("small",project.description||"Default: "+(project.defaultBranch||"unknown"));
  left.append(name,description);
  const req=project.requirements||{status:"unknown",targets:[]};
  const summary=(req.targets||[]).map(t=>[
    t.os,t.arch||null,...(t.tools||[]).map(tool=>tool.name+(tool.version?" "+tool.version:""))
   ].filter(Boolean).join(" / ")).join(" OR ");
  const status=project.archived?"Archived · alerts muted":project.ignored?
    "Ignored · alerts muted":project.compatibility?.status==="missing"?
    "Needs compatible builder":project.compatibility?.status==="compatible"?
    "Compatible builder available":"Requirements not classified";
  left.append(node("small",status+(summary?" · "+summary:""),"project-compatibility"));
  if(req.status==="inferred")left.append(node("small","Detected from GitHub Actions workflow; verify exact tool versions.","project-compatibility"));

  const details=node("small",project.builds+" local build job"+(project.builds===1?"":"s")+
   (project.latestBuild?" · Last: "+project.latestBuild.status.replaceAll("_"," "):""));
  right.append(details);
  const route=routes.find(r=>r.repository===project.fullName);
  if(route){
    const buildName=route.builder?.name||"missing builder";
    const flashName=route.flashBuilder?.name||"not set";
    left.append(node("small","Build: "+buildName+" · "+route.buildTrigger+
      " · SDK: "+(route.sdk?route.sdk.family+" "+route.sdk.version:"not assigned")+
      " · Flash: "+flashName+
      (route.autoFlashRequested?" · Auto-flash requested (blocked)":" · Manual flash"),"project-compatibility"));
  }
  if(!project.archived){
    const routeButton=node("button",route?"Edit build / flash route":"Assign build / flash route","plain-button");
    routeButton.type="button";
    routeButton.addEventListener("click",()=>openRouting(project.fullName));
    right.append(routeButton);
  }

  const link=node("a","View on GitHub");
  link.href=project.url;link.target="_blank";link.rel="noopener noreferrer";
  right.append(link);
  if(!project.archived){
    const mute=node("button",project.ignored?"Resume compatibility alerts":"Ignore compatibility alerts","plain-button");
    mute.type="button";
    mute.addEventListener("click",async()=>{
      mute.disabled=true;
      try{
        await api("/api/local/projects/ignore",{fullName:project.fullName,ignored:!project.ignored});
        await load();
      }catch(e){$("notice").textContent=e.message;mute.disabled=false}
    });
    right.append(mute);
  }
  card.append(left,right);holder.append(card);
 }
}
async function load(){
 try{
  if(!csrf){const overview=await api("/api/local/overview");csrf=overview.csrf;$("username").textContent=overview.username||"administrator";}
  const projects=await api("/api/local/projects");
  selectedOrg=projects.organization;
  const [savedRoutes,allDevices,catalog]=await Promise.all([
    selectedOrg?api("/api/local/projects/routes"):Promise.resolve({routes:[]}),
    api("/api/local/devices?mode=all"),
    api("/api/local/marketplace/releases")
  ]);
  routes=savedRoutes.routes||[];
  devices=allDevices.devices||[];
  sdkReleases=catalog.releases||[];
  const overview=await api("/api/local/overview");
  builders=overview.runners.items||[];
  $("newRepo").disabled=!selectedOrg;
  $("sync").disabled=!projects.organization;
  render(projects);
  $("notice").textContent="";
 }catch(e){$("notice").textContent=e.message;}
}
$("sync").addEventListener("click",async()=>{
 $("sync").disabled=true;$("notice").textContent="Synchronizing permitted repository metadata…";
 try{await api("/api/local/projects/sync",{});await load();}
 catch(e){$("notice").textContent=e.message;}
 finally{$("sync").disabled=false;}
});
load();

$("newRepo").addEventListener("click",async()=>{
 if(!selectedOrg){$("notice").textContent="Connect a GitHub organization first.";return;}
 try{
  const defaults=await api("/api/local/github/repository/preferences");
  $("newRepoOrg").textContent=selectedOrg;
  $("newRepoVisibility").value=defaults.defaultVisibility||"private";
  $("newRepoNotice").textContent="";
  $("newRepoForm").reset();
  $("newRepoVisibility").value=defaults.defaultVisibility||"private";
  $("newRepoDialog").showModal();
 }catch(e){$("notice").textContent=e.message;}
});
$("cancelRepo").addEventListener("click",()=>$("newRepoDialog").close());
$("newRepoForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const name=$("newRepoName").value.trim(),visibility=$("newRepoVisibility").value;
 const description=$("newRepoDescription").value.trim(),org=selectedOrg;
 if(!confirm("Create "+org+"/"+name+" as a "+visibility+" GitHub repository?"))return;
 const button=$("createRepo");button.disabled=true;
 try{
  const result=await api("/api/local/github/repository/create",{organization:org,name,description,visibility});
  $("newRepoDialog").close();
  $("notice").textContent="Created "+result.repository.fullName+". Synchronizing repository inventory…";
  try{await api("/api/local/projects/sync",{});await load();$("notice").textContent="Created "+result.repository.fullName+".";}
  catch{await load();$("notice").textContent="Created "+result.repository.fullName+". Repository inventory synchronization may need a manual refresh.";}
 }catch(e){$("newRepoNotice").textContent=e.message;}
 finally{button.disabled=false;}
});
 
function fillSelect(select,choices,emptyLabel){
  select.replaceChildren();
  if(emptyLabel!==null){
    const empty=node("option",emptyLabel);empty.value="";select.append(empty);
  }
  for(const choice of choices){
    const opt=node("option",choice.label);opt.value=choice.value;select.append(opt);
  }
}
function refreshRouteDeviceOptions(selectedId=""){
  const runnerId=$("routeFlashBuilder").value;
  const choices=devices.filter(d=>d.runnerId===runnerId).map(d=>({
    value:d.id,
    label:(d.label||d.description||d.id)+" · "+(d.connected?"connected":"offline")+
      " · "+(d.identityConfidence||"unverified")+" identity"
  }));
  fillSelect($("routeDevice"),choices,"No device selected");
  if(choices.some(x=>x.value===selectedId))$("routeDevice").value=selectedId;
}
function openRouting(repository){
  activeRouteRepo=repository;
  const policy=routes.find(r=>r.repository===repository);
  $("routeRepository").textContent=repository;
  const eligible=builders.filter(b=>b.managedHost&&!b.decommission);
  const names=eligible.map(b=>({
    value:b.id,label:(b.assignment?.displayName||b.name)+" · "+b.os+"/"+b.arch+
      (b.githubRunnerName?" · "+b.githubRunnerName:" · no GitHub runner")
  }));
  fillSelect($("routeBuild"),names,"Choose a managed builder");
  fillSelect($("routeFlashBuilder"),names,"No flash machine");
  fillSelect($("routeSdk"),sdkReleases.map(r=>({
    value:r.family+"@"+r.version,
    label:r.name+" "+r.version+" · "+r.targets.map(t=>t.os+"/"+t.arch).join(", ")
  })),"Not assigned yet");
  $("routeBuild").value=policy?.buildBuilderId||"";
  $("routeTrigger").value=policy?.buildTrigger||"manual";
  $("routeSdk").value=policy?.sdk?policy.sdk.family+"@"+policy.sdk.version:"";
  $("routeFlashBuilder").value=policy?.flashBuilderId||"";
  refreshRouteDeviceOptions(policy?.deviceId||"");
  $("routeAutoFlash").checked=!!policy?.autoFlashRequested;
  $("routeRemove").disabled=!policy;
  $("routeNotice").textContent=policy?.note||"";
  $("routeProvisionLabel").disabled=!policy||policy.buildTrigger!=="github-actions"||!policy.builder?.runnerName;
  $("routeGenerateWorkflow").disabled=!policy||policy.buildTrigger!=="github-actions";
  $("routeCopyWorkflow").hidden=true;
  $("routeWorkflowYaml").hidden=true;
  $("routeWorkflowPath").hidden=true;
  $("routeWorkflowYaml").value="";
  $("routeWorkflowState").textContent=policy?.githubRunnerLabel?
    "Runner label "+policy.githubRunnerLabel+" saved. Generate the workflow and commit it to the selected repository.":
    "Save a GitHub Actions route first. A managed, online runner and a private repository are required.";
  $("routeDialog").showModal();
}
$("routeProvisionLabel").addEventListener("click",async()=>{
  if(!activeRouteRepo)return;
  const button=$("routeProvisionLabel");button.disabled=true;
  $("routeWorkflowState").textContent="Verifying GitHub runner identity and provisioning a unique label…";
  try{
    const result=await api("/api/local/projects/routes/runner-label",{repository:activeRouteRepo});
    $("routeWorkflowState").textContent="Runner "+result.runnerName+" verified. Label "+result.label+" configured. Now generate workflow.";
    await load();
  }catch(e){$("routeWorkflowState").textContent=e.message;}
  finally{button.disabled=false;}
});
$("routeGenerateWorkflow").addEventListener("click",async()=>{
  if(!activeRouteRepo)return;
  const button=$("routeGenerateWorkflow");button.disabled=true;
  try{
    const result=await api("/api/local/projects/routes/workflow?repository="+encodeURIComponent(activeRouteRepo));
    if(!result.ready){
      $("routeWorkflowState").textContent=result.reason||"Builder routing not ready";
      return;
    }
    $("routeWorkflowYaml").value=result.workflow;
    $("routeWorkflowYaml").hidden=false;
    $("routeWorkflowPath").textContent="Commit as "+result.filePath;
    $("routeWorkflowPath").hidden=false;
    $("routeCopyWorkflow").hidden=false;
    $("routeWorkflowState").textContent="Build-only workflow ready for "+result.runnerLabel+
      ". Commit to the private repo: "+result.filePath+". Flash is NOT enabled.";
  }catch(e){$("routeWorkflowState").textContent=e.message;}
  finally{button.disabled=false;}
});
$("routeCopyWorkflow").addEventListener("click",async()=>{
  if(!$("routeWorkflowYaml").value)return;
  try{
    await navigator.clipboard.writeText($("routeWorkflowYaml").value);
    $("routeWorkflowState").textContent="Workflow YAML copied. Commit the file in GitHub or your IDE to activate builds.";
  }catch{
    $("routeWorkflowYaml").select();
    $("routeWorkflowState").textContent="Clipboard unavailable. Select and copy the YAML manually.";
  }
});
$("routeFlashBuilder").addEventListener("change",()=>refreshRouteDeviceOptions());
$("routeCancel").addEventListener("click",()=>$("routeDialog").close());
$("routeDialog").addEventListener("close",()=>{activeRouteRepo=null;});
$("routeForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!activeRouteRepo)return;
  const btn=$("routeSave");btn.disabled=true;
  try{
    const input={repository:activeRouteRepo,
      buildBuilderId:$("routeBuild").value,buildTrigger:$("routeTrigger").value,
      flashBuilderId:$("routeFlashBuilder").value||null,
      deviceId:$("routeDevice").value||null,
      autoFlashRequested:$("routeAutoFlash").checked};
    if($("routeSdk").value){
      const [family,version]=$("routeSdk").value.split("@");
      input.sdkFamily=family;input.sdkVersion=version;
    }
    const saved=await api("/api/local/projects/routes",input);
    $("routeDialog").close();
    await load();
    $("notice").textContent="Routing for "+saved.route.repository+
      " saved. No GitHub job or flash started; auto-flash execution remains blocked pending verification.";
  }catch(e){$("routeNotice").textContent=e.message;}
  finally{btn.disabled=false;}
});
$("routeRemove").addEventListener("click",async()=>{
  if(!activeRouteRepo||!confirm("Remove routing configuration for "+activeRouteRepo+"?"))return;
  const btn=$("routeRemove");btn.disabled=true;
  try{
    await api("/api/local/projects/routes/remove",{repository:activeRouteRepo});
    $("routeDialog").close();await load();
    $("notice").textContent="Build / flash routing configuration removed.";
  }catch(e){$("routeNotice").textContent=e.message;}
  finally{btn.disabled=false;}
});

$("projectSearch").addEventListener("input",renderProjectList);
$("projectFilter").addEventListener("change",renderProjectList);
const urlFilter=new URLSearchParams(location.search).get("filter");
if(["missing","unknown","ignored","archived","active"].includes(urlFilter))$("projectFilter").value=urlFilter;
setInterval(()=>{if(!document.hidden)load();},60_000);
