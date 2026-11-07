"use strict";
const category=document.getElementById("marketplaceCategory");
const rows=document.getElementById("marketplaceRows"),search=document.getElementById("marketplaceSearch"),os=document.getElementById("marketplaceOs"),notice=document.getElementById("marketplaceNotice");
let catalog=[];
try{const theme=localStorage.getItem("tt-theme");if(["graphite","paper","midnight"].includes(theme))document.body.dataset.theme=theme;}catch{}
function cell(tr,value){const td=document.createElement("td");td.textContent=String(value);tr.append(td);}
function render(){
 rows.replaceChildren();
 const query=search.value.toLowerCase().trim(),platform=os.value;
 const matches=catalog.filter(x=>(!category.value||x.category===category.value)&&(!query||(x.name+" "+x.id+" "+x.description).toLowerCase().includes(query))&&(!platform||x.targets.some(t=>t.os===platform)));
 if(!matches.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="No matching libraries.";tr.append(td);rows.append(tr);return;}
 for(const item of matches){const tr=document.createElement("tr"),name=document.createElement("td"),strong=document.createElement("strong");strong.textContent=item.name;name.append(strong);tr.append(name);cell(tr,item.version);cell(tr,item.category);const targets=item.targets.filter(t=>!platform||t.os===platform);cell(tr,targets.map(t=>t.os+" / "+t.arch).join(", "));cell(tr,[...new Set(targets.map(t=>t.readiness||"unverified"))].join(", "));rows.append(tr);}
}
async function load(){try{const response=await fetch("/api/v1/catalog",{cache:"no-store"});if(!response.ok)throw Error("Catalog request failed");const data=await response.json();catalog=data.frameworks||[];
for(const cat of [...new Set(catalog.map(x=>x.category))].sort()){const option=document.createElement("option");option.value=cat;option.textContent=cat;category.append(option);}
notice.textContent="";render();}catch(error){notice.textContent=error.message;rows.replaceChildren();}}
search.addEventListener("input",render);os.addEventListener("change",render);category.addEventListener("change",render);load();
