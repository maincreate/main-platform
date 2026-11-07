"use strict";
(function(){
 const $=id=>document.getElementById(id),container=$("githubActionsRuns"),source=$("actionsSource");
 const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;return n;};
 const cell=(row,value)=>{const c=el("td",value);row.append(c);return c;};
 let allRuns=[],sourceMessage="";
 function render(){
  container.replaceChildren();
  if(sourceMessage){const note=el("p",sourceMessage,"home-error");container.append(note);}
  const query=$("actionSearch").value.trim().toLowerCase(),status=$("actionStatus").value;
  const runs=allRuns.filter(r=>(!query||[r.name,r.title,r.repository,r.branch].join(" ").toLowerCase().includes(query))&&
    (status==="all"||(r.conclusion||r.status)===status));
  if(!runs.length){container.append(el("p","No matching GitHub workflow runs."));return;}
  const table=el("table",undefined,"tt-jobs-table"),thead=el("thead"),headers=el("tr");
  for(const h of ["Workflow","Repository","Result","When","Actions"])headers.append(el("th",h));
  thead.append(headers);table.append(thead);
  const tbody=el("tbody");
  for(const run of runs){
   const row=el("tr"),title=cell(row,run.name||"Workflow");title.append(el("div",run.title||"","tt-job-meta"));
   cell(row,run.repository);cell(row,run.conclusion||run.status||"unknown");
   cell(row,run.created_at?new Date(run.created_at).toLocaleString():"—");
   const actions=cell(row,""),link=el("a","View in GitHub");
   link.className="plain-button";link.href=run.url;link.target="_blank";link.rel="noopener noreferrer";actions.append(link);
   if(run.conclusion==="success"){
    const flash=el("button","Flash device");flash.type="button";flash.className="plain-button";
    flash.addEventListener("click",()=>window.openGitHubFlash?.(run));actions.append(flash);
   }
   tbody.append(row);
  }
  table.append(tbody);container.append(table);
 }
 async function load(){
  $("refreshActions").disabled=true;
  try{
   const response=await fetch("/api/local/actions/runs",{credentials:"same-origin",cache:"no-store"});
   if(response.status===401){location.replace("/setup");return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"Unable to read GitHub Actions runs");
   allRuns=Array.isArray(data.runs)?data.runs:[];
   sourceMessage=data.message||"";
   source.textContent=(data.organization||"GitHub")+" · "+(data.repositoriesScanned||0)+" repositories inspected";
   render();
  }catch(e){source.textContent="GitHub workflow history unavailable";allRuns=[];sourceMessage=e.message;render();}
  finally{$("refreshActions").disabled=false;}
 }
 $("actionSearch").addEventListener("input",render);
 $("actionStatus").addEventListener("change",render);
 $("refreshActions").addEventListener("click",load);
 load();
})();
