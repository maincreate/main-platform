"use strict";
const $=id=>document.getElementById(id);
let csrf=null;
try{const t=localStorage.getItem("tt-theme");if(["graphite","paper","midnight"].includes(t))document.body.dataset.theme=t;}catch{}
async function api(path,body){
 const request={credentials:"same-origin",cache:"no-store"};
 if(body!==undefined){request.method="POST";request.headers={"content-type":"application/json","x-tt-csrf":csrf};request.body=JSON.stringify(body);}
 const response=await fetch(path,request);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(value.error||"Builder request failed");
 return value;
}
function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
async function load(){
 const overview=await api("/api/local/overview");csrf=overview.csrf;
 $("username").textContent=overview.username||"administrator";
 const list=$("runners-list");list.replaceChildren();
 const runners=overview.runners?.items||[];
 if(!runners.length){list.append(el("p","No build hosts enrolled. Use Add Builder to generate an enrollment token."));return;}
 const table=el("table");table.className="inventory-table";
 const thead=el("thead"),header=el("tr");
 for(const h of ["Builder","Operating system","Architecture","Last seen"]){const th=el("th",h);header.append(th);}
 thead.append(header);table.append(thead);
 const tbody=el("tbody");
 for(const runner of runners){const row=el("tr");for(const v of [runner.name,runner.os,runner.arch,runner.lastSeen?new Date(runner.lastSeen).toLocaleString():"Never"]){row.append(el("td",v||"—"));}tbody.append(row);}
 table.append(tbody);list.append(table);
}
$("refresh").addEventListener("click",()=>load().catch(e=>$("notification").textContent=e.message));
$("invite").addEventListener("click",async()=>{
 const button=$("invite");button.disabled=true;
 try{if(!csrf)await load();const invite=await api("/api/local/runners/invite",{});
  $("enrollCommand").textContent="TT_CONTROLLER_URL='"+location.origin+"' TT_ENROLLMENT_TOKEN='"+invite.token+"' node runner/agent.mjs enroll";
  $("enrollment").hidden=false;
  $("notification").textContent="Pairing token generated. It is shown once and expires in 10 minutes.";
 }catch(e){$("notification").textContent=e.message;}finally{button.disabled=false;}
});
load().catch(e=>$("notification").textContent=e.message);
