"use strict";
const $=id=>document.getElementById(id);
let csrf=null;
try {
  const preference=localStorage.getItem("tt-theme");
  document.body.dataset.theme=["graphite","paper","midnight"].includes(preference)?preference:"midnight";
}catch{document.body.dataset.theme="midnight";}
async function load(){
  try {
    const response=await fetch("/api/local/overview",{cache:"no-store",credentials:"same-origin"});
    if(response.status===401){window.location.replace("/setup");return;}
    if(!response.ok)throw Error("Unable to read workspace status");
    const data=await response.json();
    csrf=data.csrf;
    $("username").textContent=data.username||"administrator";
    renderTopology(data);
  }catch(e){
    $("topologySummary").textContent=e.message||"Workspace status unavailable";
  }
}
$("signout").addEventListener("click",async()=>{
  if(!csrf)return;
  try {
    await fetch("/api/local/logout",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json","x-tt-csrf":csrf},body:"{}"});
  }finally{window.location.replace("/setup");}
});
// Read-only topology. Every node is based on overview data or explicitly marked unverified.
// Lines indicate conceptual relationships; only a recent runner heartbeat is rendered solid.
let selectedRunner=null;
let topoEdges=[];
const topoSVG="http://www.w3.org/2000/svg";
function createSpan(className,value){
  const span=document.createElement("span");
  span.className=className;span.textContent=value;return span;
}
function recentHeartbeat(value){
  if(typeof value!=="string")return false;
  const at=Date.parse(value),elapsed=Date.now()-at;
  return Number.isFinite(at)&&elapsed>=-120000&&elapsed<=300000;
}
function lastSeenDescription(value){
  const at=Date.parse(value||"");
  if(!Number.isFinite(at))return "No heartbeat reported";
  const minutes=Math.max(0,Math.floor((Date.now()-at)/60000));
  if(minutes<1)return "Heartbeat less than a minute ago";
  if(minutes<60)return "Last heartbeat "+minutes+" minute"+(minutes===1?"":"s")+" ago";
  const hours=Math.floor(minutes/60);
  if(hours<24)return "Last heartbeat "+hours+" hour"+(hours===1?"":"s")+" ago";
  return "Last heartbeat "+Math.floor(hours/24)+" day(s) ago";
}
function renderTopology(data){
  const gh=!!data.github?.identityConnected;
  const githubOrg=gh?data.github?.organization:null;
  const githubAuthorized=!!githubOrg;
  const githubNode=document.querySelector('[data-topology-node="cloud-github"]');
  if(githubNode)githubNode.dataset.connected=String(githubAuthorized);
  $("topoGithub").textContent=githubAuthorized?"Connected · "+githubOrg:
    gh?"Account linked":data.github?.authorizationExpired?"Reconnect required":"Not connected";
  $("topoGithubMeta").textContent=githubAuthorized?
    (data.github?.login?"Authorized as @"+data.github.login:"GitHub account authorized"):
    gh?"Choose an organization to connect the workspace":
    data.github?.authorizationExpired?
      (data.github?.savedOrganization?"Previously selected: "+data.github.savedOrganization:"Authorization expired"):
      "Code and repositories";
  $("topoWorkspace").textContent=data.workspace?.name||"TinkerTunnel";
  const records=Array.isArray(data.runners?.items)?data.runners.items.slice(0,8):[];
  const holder=$("topologyRunners");
  holder.replaceChildren();
  topoEdges=[
    ["cloud-github","workspace",githubAuthorized],
    ["cloud-assistant","secure",false],
    ["secure","mcp",false],
    ["mcp","workspace",false]
  ];
  if(!records.length){
    const node=document.createElement("div");
    node.className="topology-node empty";node.dataset.topologyNode="runner-empty";
    node.append(createSpan("topology-label","No build machines yet"),
      createSpan("topology-state","Not enrolled"),
      createSpan("topology-hint","Add a trusted machine when ready"));
    holder.append(node);
    topoEdges.push(["workspace","runner-empty",false],["runner-empty","toolkits",false]);
    $("topologySummary").textContent=(githubAuthorized?"GitHub connected to "+githubOrg+". ":"")+"No machines enrolled. Build machines can be added when ready.";
  }else{
    let recent=0;
    for(const runner of records){
      const fresh=recentHeartbeat(runner.lastSeen);
      if(fresh)recent++;
      const node=document.createElement("button");
      node.type="button";node.className="topology-node";
      node.dataset.topologyNode="runner-"+String(runner.id||"");
      node.dataset.runnerId=String(runner.id||"");
      node.dataset.fresh=String(fresh);
      node.setAttribute("aria-pressed",String(selectedRunner===runner.id));
      node.append(createSpan("topology-label",runner.name||"Unnamed machine"),
        createSpan("topology-state",fresh?"Recently seen":"No recent heartbeat"),
        createSpan("topology-hint",(runner.os||"unknown")+" / "+(runner.arch||"unknown")));
      node.addEventListener("click",()=>selectRunner(runner,records));
      holder.append(node);
      topoEdges.push(["workspace",node.dataset.topologyNode,fresh]);
      topoEdges.push([node.dataset.topologyNode,"toolkits",false]);
    }
    const hidden=Number(data.runners?.count||0)-records.length;
    if(hidden>0)holder.append(createSpan("topology-overflow","+"+hidden+" more enrolled machines"));
    $("topologySummary").textContent=records.length+" machine(s) shown; "+recent+" with a recent heartbeat. Toolkit inventory has not been implemented.";
  }
  $("topologyReset").hidden=true;
  selectedRunner=null;
  scheduleTopologyLines();
}
function selectRunner(runner,records){
  const id=String(runner.id||"");
  selectedRunner=selectedRunner===id?null:id;
  const focused=records.find(r=>String(r.id||"")===selectedRunner);
  document.querySelectorAll("#topologyRunners [data-runner-id]").forEach(node=>{
    const chosen=!!focused&&node.dataset.runnerId===selectedRunner;
    node.setAttribute("aria-pressed",String(chosen));
    node.dataset.dimmed=String(!!focused&&!chosen);
  });
  $("topologyReset").hidden=!focused;
  $("topologySummary").textContent=focused?
    (focused.name||"Machine")+" · "+(focused.os||"unknown")+"/"+(focused.arch||"unknown")+" · "+
      lastSeenDescription(focused.lastSeen)+". Build execution is not enabled.":
    records.length+" displayed machine(s); toolkits are not discovered yet.";
  scheduleTopologyLines();
}
$("topologyReset").addEventListener("click",()=>{
  const selected=document.querySelector('#topologyRunners [aria-pressed="true"]');
  if(selected)selected.click();
});
let topoDrawQueued=false;
function scheduleTopologyLines(){
  if(topoDrawQueued)return;
  topoDrawQueued=true;
  requestAnimationFrame(()=>{topoDrawQueued=false;drawTopologyLines();});
}
function drawTopologyLines(){
  const map=$("topologyMap"),svg=$("topologyLinks");
  if(!map||!svg)return;
  svg.replaceChildren();
  const box=map.getBoundingClientRect();
  const width=map.offsetWidth,height=map.offsetHeight;
  svg.setAttribute("viewBox","0 0 "+width+" "+height);
  svg.setAttribute("width",String(width));svg.setAttribute("height",String(height));
  const nodeRect=id=>{
    const node=Array.from(map.querySelectorAll("[data-topology-node]"))
      .find(el=>el.dataset.topologyNode===id);
    if(!node)return null;
    const r=node.getBoundingClientRect();
    return {x1:r.left-box.left,y:r.top-box.top+r.height/2,x2:r.right-box.left};
  };
  for(const [from,to,observed] of topoEdges){
    const a=nodeRect(from),b=nodeRect(to);
    if(!a||!b||b.x1<=a.x2)continue;
    const mid=(a.x2+b.x1)/2;
    const path=document.createElementNS(topoSVG,"path");
    path.setAttribute("d","M "+a.x2+" "+a.y+" H "+mid+" V "+b.y+" H "+b.x1);
    path.setAttribute("class",observed?"is-observed":"is-planned");
    // The map never calls a conceptual edge a verified connection.
    svg.append(path);
  }
}
window.addEventListener("resize",scheduleTopologyLines);
if(typeof ResizeObserver!=="undefined"){
  const observer=new ResizeObserver(scheduleTopologyLines);
  observer.observe($("topologyMap"));
}

load();
