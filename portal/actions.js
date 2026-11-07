"use strict";
(function(){
 const $=id=>document.getElementById(id),container=$("githubActionsRuns"),source=$("actionsSource");
 function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
 function cell(row,value){const td=el("td",value);row.append(td);return td;}
 let allRuns=[],sourceMessage=null;
 function clear(){container.replaceChildren();}
 function render(){
 clear();
 if(sourceMessage){const note=el("p",sourceMessage);note.className="home-error";container.append(note);}
 const search=$("actionSearch").value.toLowerCase().trim(),status=$("actionStatus").value;
 const runs=allRuns.filter(r=>(!search||[r.name,r.title,r.repository,r.branch].join(" ").toLowerCase().includes(search))&&
 (status==="all"||(r.conclusion||r.status)===status));
 async function load(){
  $("refreshActions").disabled=true;
  try{
   const response=await fetch("/api/local/actions/runs",{credentials:"same-origin",cache:"no-store"});
   if(response.status===401){location.replace("/setup");return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"Unable to read GitHub Actions runs");
   source.textContent=(data.organization||"GitHub")+" · "+(data.repositoriesScanned||0)+" repositories inspected";
   allRuns=data.runs||[];sourceMessage=data.message||null;
   render();
  }catch(error){clear();source.textContent="GitHub workflow history unavailable";container.append(el("p",error.message));}
  finally{$("refreshActions").disabled=false;}
 }

   if(!allRuns.length){container.append(el("p","No GitHub workflow runs found."));return;}
   const table=el("table");table.className="tt-jobs-table";
   const head=el("tr");for(const name of ["Workflow","Repository","Result","When","Actions"])head.append(el("th",name));
   const thead=el("thead");thead.append(head);table.append(thead);
   const body=el("tbody");
   for(const run of runs){
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
  }
 $("actionSearch").addEventListener("input",render);
 $("actionStatus").addEventListener("change",render);
 $("refreshActions").addEventListener("click",load);load();
})();
