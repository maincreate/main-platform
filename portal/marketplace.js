"use strict";
const $=id=>document.getElementById(id);
const category=$("marketplaceCategory"),rows=$("marketplaceRows"),tiles=$("marketplaceTiles");
const search=$("marketplaceSearch"),os=$("marketplaceOs"),notice=$("marketplaceNotice");
let catalog=[],view="tiles";
const approvedLogos={
 "esp-idf":"https://github.com/espressif.png?size=96",
 "lvgl":"https://github.com/lvgl.png?size=96",
 "swift":"https://github.com/swiftlang.png?size=96"
};
try{const t=localStorage.getItem("tt-theme");if(["graphite","paper","midnight"].includes(t))document.body.dataset.theme=t;}catch{}
function text(parent,tag,value,cls){const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(cls)el.className=cls;parent.append(el);return el;}
function matching(){
 const query=search.value.trim().toLowerCase(),platform=os.value;
 return catalog.filter(x=>(!category.value||x.category===category.value)&&
  (!query||[x.name,x.id,x.description,x.category].join(" ").toLowerCase().includes(query))&&
  (!platform||x.targets?.some(t=>t.os===platform)));
}
function render(){
 tiles.replaceChildren();rows.replaceChildren();
 $("marketplaceTable").hidden=view!=="list";tiles.hidden=view!=="tiles";
 $("tileView").setAttribute("aria-pressed",String(view==="tiles"));
 $("listView").setAttribute("aria-pressed",String(view==="list"));
 for(const item of matching()){
  const targets=(item.targets||[]).filter(t=>!os.value||t.os===os.value);
  const tile=text(tiles,"article",undefined,"tt-marketplace-tile");
  const top=text(tile,"div",undefined,"tt-marketplace-tile-head");
  const icon=text(top,"div",item.icon||item.name.slice(0,2),"tt-marketplace-logo");
  if(approvedLogos[item.id]){
   icon.textContent="";
   const img=document.createElement("img");img.src=approvedLogos[item.id];
   img.alt="";img.loading="lazy";img.referrerPolicy="no-referrer";
   img.addEventListener("error",()=>{icon.textContent=item.icon||item.name.slice(0,2);img.remove();},{once:true});
   icon.append(img);
  }
  const labels=text(top,"div");text(labels,"h3",item.name);text(labels,"small","v"+item.version);
  text(tile,"p",item.description||"");
  text(tile,"span",item.category,"tt-marketplace-category");
  text(tile,"div",targets.map(t=>t.os+"/"+t.arch).join(" · "),"tt-marketplace-targets");
  const tr=text(rows,"tr");text(tr,"td",item.name);text(tr,"td",item.version);
  text(tr,"td",item.category);text(tr,"td",targets.map(t=>t.os+"/"+t.arch).join(", "));
  text(tr,"td",[...new Set(targets.map(t=>t.readiness||"unverified"))].join(", "));
 }
}
async function load(){
 try{
  const response=await fetch("/api/v1/catalog",{cache:"no-store"});
  if(!response.ok)throw Error("Catalog request failed");
  const data=await response.json();catalog=data.frameworks||[];
  category.replaceChildren();const all=document.createElement("option");all.value="";all.textContent="All categories";category.append(all);
  for(const value of [...new Set(catalog.map(x=>x.category))].sort()){
   const option=document.createElement("option");option.value=value;option.textContent=value;category.append(option);
  }
  notice.textContent="";render();
 }catch(e){notice.textContent=e.message;tiles.replaceChildren();rows.replaceChildren();}
}
for(const control of [search,os,category])control.addEventListener(control===search?"input":"change",render);
$("tileView").addEventListener("click",()=>{view="tiles";render();});
$("listView").addEventListener("click",()=>{view="list";render();});
load();
