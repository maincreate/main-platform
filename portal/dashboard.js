"use strict";
const $=id=>document.getElementById(id);
const allowed=["graphite","paper","midnight"];
let csrf=null;
function theme(id){
  if(!allowed.includes(id))id="midnight";
  document.body.dataset.theme=id;
  document.querySelectorAll(".theme-choice").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.palette===id)));
  try{localStorage.setItem("tt-theme",id);}catch{}
}
try{theme(localStorage.getItem("tt-theme")||"midnight");}catch{theme("midnight");}
document.querySelectorAll(".theme-choice").forEach(b=>b.addEventListener("click",()=>theme(b.dataset.palette)));
async function load(){
  try{
    const r=await fetch("/api/local/overview",{cache:"no-store",credentials:"same-origin"});
    if(r.status===401){window.location.replace("/setup");return;}
    if(!r.ok)throw Error("Workspace status unavailable");
    const d=await r.json();
    csrf=d.csrf;
    $("username").textContent=d.username||"administrator";
    const connected=!!d.github?.identityConnected;
    const hasOrg=!!d.github?.organization;
    $("github-status").textContent=hasOrg?"Organization selected":connected?"GitHub connected":"Not connected";
    const nodes=Number(d.runners?.count||0);
    $("runners-status").textContent=nodes?nodes+" enrolled":"Not connected";
    $("runner-detail").textContent=nodes?nodes+" machine"+(nodes===1?"":"s")+" enrolled. Build execution is not enabled yet.":"No build machines enrolled.";
    $("assistant-status").textContent="Not connected";
    $("connection-count").textContent=Number(connected)+Number(nodes>0)+" of 3 connected";
    renderTopology(d);
  }catch(e){$("connection-count").textContent="Connection status unavailable";}
}
$("accountSettings").addEventListener("click",()=>$("accountDialog").showModal());
$("closeAccount").addEventListener("click",()=>$("accountDialog").close());
$("passwordForm").addEventListener("submit",async e=>{
  e.preventDefault();
  $("accountError").textContent="";
  const password=$("nextPassword").value;
  if(password!==$("confirmNextPassword").value){$("accountError").textContent="Passwords do not match.";return;}
  try{
    const res=await fetch("/api/local/account/password",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-tt-csrf":csrf},body:JSON.stringify({currentPassword:$("currentPassword").value,newPassword:password})});
    const d=await res.json();
    if(!res.ok)throw Error(d.error||"Unable to change password");
    window.location.replace("/setup");
  }catch(err){$("accountError").textContent=err.message;}
});
$("signout").addEventListener("click",async()=>{
  if(!csrf)return;
  try{await fetch("/api/local/logout",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-tt-csrf":csrf},body:"{}"});}
  finally{window.location.replace("/setup");}
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
  $("topoGithub").textContent=gh?"GitHub account linked":"Not connected";
  $("topoWorkspace").textContent=data.workspace?.name||"TinkerTunnel";
  const records=Array.isArray(data.runners?.items)?data.runners.items.slice(0,8):[];
  const holder=$("topologyRunners");
  holder.replaceChildren();
  topoEdges=[
    ["cloud-github","workspace",false],
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
    $("topologySummary").textContent="No machines enrolled. GitHub and build connections can be configured after account creation.";
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
    records.length+" enrolled machine(s); toolkits are not discovered yet.";
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
