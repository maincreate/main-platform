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
    topoEdges.push(["workspace","runner-empty",false]);
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
      // Device links are rendered separately, scoped to each reporting builder.
    }
    const hidden=Number(data.runners?.count||0)-records.length;
    if(hidden>0)holder.append(createSpan("topology-overflow","+"+hidden+" more enrolled machines"));
    $("topologySummary").textContent=records.length+" machine(s) shown; "+recent+" with a recent heartbeat. Available tools are shown on each builder.";
  }
  const devices=Array.isArray(data.devices?.items)?data.devices.items.slice(0,10):[];
  const deviceHolder=$("topologyDevices");
  deviceHolder.replaceChildren();
  if(!devices.length){
    const node=document.createElement("div");
    node.className="topology-node empty";node.dataset.topologyNode="device-empty";
    node.append(createSpan("topology-label","No devices reported"),
      createSpan("topology-state","Not discovered"),
      createSpan("topology-hint","Automatic hardware discovery when a builder is enrolled"));
    deviceHolder.append(node);
    for(const r of records)topoEdges.push(["runner-"+r.id,"device-empty",false]);
    if(!records.length)topoEdges.push(["runner-empty","device-empty",false]);
    topoEdges.push(["device-empty","toolkits",false]);
  }else{
    for(const d of devices){
      const node=document.createElement("div");
      node.className="topology-node";
      node.dataset.topologyNode="device-"+d.id;
      node.dataset.connected=String(d.lifecycle==="connected");
      node.append(createSpan("topology-label",d.label||d.product||d.description||"USB serial"),
        createSpan("topology-state",d.lifecycle==="connected"?"Connected":"Last seen device"),
        createSpan("topology-hint",(d.runnerName||"Builder")+" · "+d.port));
      deviceHolder.append(node);
      const runner=records.find(r=>r.id===d.runnerId);
      if(runner)topoEdges.push(["runner-"+runner.id,"device-"+d.id,
         d.lifecycle==="connected"&&recentHeartbeat(runner.lastSeen)]);
      topoEdges.push(["device-"+d.id,"toolkits",false]);
    }
    $( "topologySummary").textContent+=" "+devices.filter(d=>d.lifecycle==="connected").length+
      " connected serial device(s) in inventory.";
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
      lastSeenDescription(focused.lastSeen)+". Manage runs from Jobs.":
    records.length+" displayed machine(s); toolkits are not discovered yet.";
  scheduleTopologyLines();
}
$("topologyReset").addEventListener("click",()=>{
  const selected=document.querySelector('#topologyRunners [aria-pressed="true"]');
  if(selected)selected.click();
});
// The topology uses a responsive two-track layout. No SVG routing or crossing lines.
function scheduleTopologyLines(){}
load();
