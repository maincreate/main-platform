"use strict";
(function(){
 const $=id=>document.getElementById(id),container=$("githubActionsRuns"),source=$("actionsSource");
 function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
 function cell(row,value){const td=el("td",value);row.append(td);return td;}
 function clear(){container.replaceChildren();}
 async function load(){
  $("refreshActions").disabled=true;
  try{
   const response=await fetch("/api/local/actions/runs",{credentials:"same-origin",cache:"no-store"});
   if(response.status===401){location.replace("/setup");return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"Unable to read GitHub Actions runs");
   clear();source.textContent=(data.organization||"GitHub")+" · "+(data.repositoriesScanned||0)+" repositories inspected";
   if(data.message){const note=el("p",data.message);note.className="home-error";container.append(note);}
   if(!data.runs?.length){container.append(el("p","No GitHub workflow runs found."));return;}
   const table=el("table");table.className="tt-jobs-table";
   const head=el("tr");for(const name of ["Workflow","Repository","Result","When","Actions"])head.append(el("th",name));
   const thead=el("thead");thead.append(head);table.append(thead);
   const body=el("tbody");
   for(const run of data.runs){
    const tr=el("tr"),title=cell(tr,run.name||"Workflow");title.append(el("div",run.title||"","tt-job-meta"));
    cell(tr,run.repository);
    cell(tr,run.conclusion||run.status||"unknown");
    cell(tr,run.created_at?new Date(run.created_at).toLocaleString():"—");
    const actions=cell(tr,"");const view=el("a","View in GitHub");view.className="plain-button";
    view.href=run.url;view.target="_blank";view.rel="noopener noreferrer";actions.append(view);
    if(run.conclusion==="success"){
      const flash=el("button","Flash device");flash.className="plain-button";flash.type="button";
      flash.addEventListener("click",()=>window.openGitHubFlash?.(run));
      actions.append(flash);
    }
    body.append(tr);
   }
   table.append(body);container.append(table);
  }catch(error){clear();source.textContent="GitHub workflow history unavailable";container.append(el("p",error.message));}
  finally{$("refreshActions").disabled=false;}
 }
 $("refreshActions").addEventListener("click",load);load();
})();
