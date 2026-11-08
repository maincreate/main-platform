"use strict";
const $=id=>document.getElementById(id);
try{const theme=localStorage.getItem("tt-theme");if(["midnight","graphite","paper"].includes(theme))document.body.dataset.theme=theme;}catch{}
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
async function api(path){
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store"});
 if(response.status===401){location.replace("/setup");throw new Error("Sign in required");}
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(value.error||"Unable to fetch "+path);
 return value;
}
function statusText(node,text){$(node).textContent=text;}
function relative(date){
 if(!date)return "Never";
 const ms=Date.now()-Date.parse(date);
 if(!Number.isFinite(ms))return "Unknown";
 if(ms<60000)return "Just now";
 if(ms<3600000)return Math.floor(ms/60000)+"m ago";
 if(ms<86400000)return Math.floor(ms/3600000)+"h ago";
 return new Date(date).toLocaleDateString();
}
function row(parent,title,subtitle,detail){
 const e=element("div",undefined,"list-row"),main=element("div"),name=element("strong",title),
 meta=element("small",subtitle),side=element("span",detail||"","row-detail");
 main.append(name,meta);e.append(main,side);parent.append(e);return e;
}
function empty(parent,heading,description,href,label){
 parent.replaceChildren();
 const box=element("div",undefined,"home-empty");
 box.append(element("strong",heading),element("p",description));
 if(href){const a=element("a",label,"quiet-link");a.href=href;box.append(a);}
 parent.append(box);
}
function renderJobs(jobs){
 const holder=$("recentJobs");holder.replaceChildren();
 if(!jobs?.length)return empty(holder,"No jobs yet","Builds and other approved operations will appear here.","/jobs","Open Jobs");
 for(const job of jobs.slice(0,5)){
  const source=job.source?.repository?" · "+job.source.repository:"";
  row(holder,job.capability,(job.created_at?relative(job.created_at):"")+" · "+job.runner_id.slice(0,10)+source,job.status.replaceAll("_"," "));
 }
}
// The homepage is an activity shortlist, not the complete organization inventory.
// GitHub pushed_at is the latest code push seen during sync; latestBuild is a
// recorded TinkerTunnel build. Neither field claims to be a GitHub Actions run.
function projectTime(value){
 const parsed=Date.parse(value||"");
 return Number.isFinite(parsed)?parsed:0;
}
function mostRecentProjects(repositories,limit=5){
 return repositories.filter(p=>!p.archived&&!p.ignored)
  .sort((a,b)=>{
   const activity=project=>Math.max(projectTime(project.pushedAt),projectTime(project.latestBuild?.created_at));
   return activity(b)-activity(a)||a.fullName.localeCompare(b.fullName);
  }).slice(0,limit);
}
function renderProjects(projects){
 const holder=$("projectList");holder.replaceChildren();
 if(!projects?.repositories?.length){
  return empty(holder,projects?.organization?"No projects discovered":"GitHub organization not connected",
   projects?.organization?"Open Projects to synchronize your GitHub App repositories.":"Connect GitHub in Settings to view your repositories.",
   projects?.organization?"/projects":"/settings","Open "+(projects?.organization?"Projects":"Settings"));
 }
 const recent=mostRecentProjects(projects.repositories);
 if(!recent.length)return empty(holder,"No active projects to show",
  "Archived and ignored projects stay available in the full project inventory.",
  "/projects","View all projects");
 for(const project of recent){
  const pushed=projectTime(project.pushedAt),built=projectTime(project.latestBuild?.created_at);
  const activity=built>pushed?"Build":pushed>0?"Push":built>0?"Build":null;
  const last=Math.max(pushed,built);
  const details=activity?activity+" "+relative(new Date(last).toISOString()):"No recorded activity";
  row(holder,project.fullName,
   details+" · "+(project.description||"Default branch: "+(project.defaultBranch||"unknown")),
   Number(project.builds||0)+" build"+(Number(project.builds||0)===1?"":"s"));
 }
}
function renderBuilders(overview){
 const holder=$("buildersList");holder.replaceChildren();
 const list=overview.runners?.items||[];
 if(!list.length)return empty(holder,"No build machines enrolled","Enroll a trusted Linux, macOS or Windows host to begin recording capabilities and jobs.",
  "/builders","Manage build machines");
 for(const runner of list.slice(0,5)){
  const recent=Number.isFinite(Date.parse(runner.lastSeen))&&Date.now()-Date.parse(runner.lastSeen)<120000;
  row(holder,runner.name,runner.os+" / "+runner.arch,recent?"Online":relative(runner.lastSeen));
 }
}
function renderDevices(inventory){
 const holder=$("devicesList");holder.replaceChildren();
 const list=inventory?.devices||[];
 if(!list.length)return empty(holder,"No devices reported","USB serial devices appear automatically when an enrolled builder has read-only discovery enabled.",
  "/devices","Open device inventory");
 for(const device of list.slice(0,6)){
  row(holder,device.label||device.product||device.description||"USB serial device",
   device.runnerName+" · "+device.port+" · "+device.vid.toString(16).padStart(4,"0")+":"+device.pid.toString(16).padStart(4,"0"),
   device.lifecycle==="connected"?"Connected":"Last seen "+relative(device.lastSeen));
 }
}

/* Operational activity histogram; buckets and drilldowns use real ledger entries only. */
let activityRange="7d",activityData=null,activitySelected=null;
const svgNS="http://www.w3.org/2000/svg";
function svgEl(name,attrs={}){
 const node=document.createElementNS(svgNS,name);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
 return node;
}
function activityBuckets(data){
 const hours=data.range==="24h",days=data.range==="7d"?7:30,count=hours?24:days;
 const width=hours?3600000:86400000,now=Date.parse(data.generatedAt);
 const ending=Math.floor(now/width)*width+width;
 const start=ending-width*count;
 const buckets=Array.from({length:count},(_,i)=>({start:start+i*width,end:start+(i+1)*width,build:[],job:[]}));
 for(const event of data.events||[]){
  const at=Date.parse(event.time),index=Math.floor((at-start)/width);
  if(index>=0&&index<count&&["build","job"].includes(event.type))buckets[index][event.type].push(event);
 }
 return buckets;
}
function bucketLabel(bucket,range){
 const d=new Date(bucket.start);
 return range==="24h"?d.toLocaleTimeString([],{hour:"numeric"}):
  d.toLocaleDateString([],{month:"short",day:"numeric"});
}
function renderActivityDetails(bucket){
 const holder=$("activityDetails");holder.replaceChildren();
 if(!bucket){holder.append(element("div","Select a time bar to inspect its operations.","tt-activity-empty"));return;}
 const total=bucket.build.length+bucket.job.length;
 holder.append(element("div",bucketLabel(bucket,activityRange)+" · "+total+" recorded operation"+(total===1?"":"s"),"tt-activity-detail-title"));
 if(!total){holder.append(element("p","No recorded operations in this period.","tt-activity-empty"));return;}
 for(const event of [...bucket.build,...bucket.job].sort((a,b)=>b.time.localeCompare(a.time))){
  const row=element("div",undefined,"tt-activity-detail-row"),left=element("div");
  const name=element("strong",(event.type==="build"?"Build: ":"Job: ")+event.title);
  const runner=activityBuilders.find(b=>b.id===event.builderId);
  left.append(name,element("small",(runner?.name||event.repository||event.builderId||"Builder not recorded")+
   " · "+event.status+" · "+new Date(event.time).toLocaleString()));
  const link=element("a",event.source==="github"?"Open GitHub run":"View job");link.href=event.url;
  if(event.source==="github"){link.target="_blank";link.rel="noopener noreferrer";}
  row.append(left,link);holder.append(row);
 }
}
let activityBuilders=[];
function renderActivityChart(){
 const holder=$("activityChart");holder.replaceChildren();
 if(!activityData)return;
 // Match the actual plot width to the panel. A fixed 960px SVG viewBox
 // was letterboxed by preserveAspectRatio on wide displays.
 const measured=Math.floor(holder.getBoundingClientRect().width);
 const buckets=activityBuckets(activityData),width=Math.max(480,measured||480),
  height=230,left=38,right=12,top=14,bottom=33;
 const chartW=width-left-right,chartH=height-top-bottom;
 const counts=buckets.map(x=>x.build.length+x.job.length);
 const max=Math.max(1,...counts),scale=Math.max(1,Math.ceil(max/4))*4;
 const svg=svgEl("svg",{viewBox:"0 0 "+width+" "+height,role:"img",
  "aria-label":"Activity from "+new Date(buckets[0].start).toLocaleString()+" to "+new Date(buckets.at(-1).end).toLocaleString()});
 svg.classList.add("tt-activity-svg");
 for(let i=0;i<=4;i++){
  const value=Math.round(scale*i/4),y=top+chartH*(1-i/4);
  svg.append(svgEl("line",{x1:left,x2:width-right,y1:y,y2:y,class:"gridline"}));
  const label=svgEl("text",{x:left-8,y:y+4,"text-anchor":"end",class:"chart-label"});label.textContent=value;svg.append(label);
 }
 const step=chartW/buckets.length;
 buckets.forEach((bucket,i)=>{
  const x=left+i*step+Math.max(2,step*.12),bw=Math.max(2,step*.76);
  let y=top+chartH;
  for(const type of ["build","job"]){
   const n=bucket[type].length,h=n/scale*chartH;
   if(h>0){y-=h;svg.append(svgEl("rect",{x,y,width:bw,height:h,rx:1,class:"bar-"+type}));}
  }
  if(i===0||i===buckets.length-1||i%Math.max(1,Math.floor(buckets.length/7))===0){
   const label=svgEl("text",{x:x+bw/2,y:height-11,"text-anchor":"middle",class:"chart-label"});
   label.textContent=bucketLabel(bucket,activityRange);svg.append(label);
  }
  const hit=svgEl("rect",{x:x-1,y:top,width:bw+2,height:chartH,tabindex:0,role:"button",
   "aria-label":bucketLabel(bucket,activityRange)+": "+counts[i]+" operations",
   "aria-pressed":activitySelected===i?"true":"false",class:"activity-hitbox"});
  const tooltip=svgEl("title");tooltip.textContent=bucketLabel(bucket,activityRange)+
   " · "+bucket.build.length+" builds · "+bucket.job.length+" jobs";hit.append(tooltip);
  const select=()=>{activitySelected=i;renderActivityChart();};
  hit.addEventListener("click",select);
  hit.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();select();}});
  svg.append(hit);
 });
 holder.append(svg);
 activityRenderedWidth=measured;
 renderActivityDetails(activitySelected===null?null:buckets[activitySelected]||null);
}
// Keep geometry in screen pixels as the dashboard resizes. Debounce with
// animation frames so resize and sidebar changes do not cause redraw storms.
let activityResizeFrame=0,activityRenderedWidth=0;
const activityContainer=$("activityChart");
if(typeof ResizeObserver!=="undefined"){
 const activityResizeObserver=new ResizeObserver(entries=>{
  const width=Math.floor(entries[0]?.contentRect.width||0);
  if(!activityData||Math.abs(width-activityRenderedWidth)<2)return;
  if(activityResizeFrame)cancelAnimationFrame(activityResizeFrame);
  activityResizeFrame=requestAnimationFrame(()=>{
   activityResizeFrame=0;
   activityRenderedWidth=Math.floor(activityContainer.getBoundingClientRect().width);
   renderActivityChart();
  });
 });
 activityResizeObserver.observe(activityContainer);
}
async function loadActivity(){
 const local=await api("/api/local/activity?range="+encodeURIComponent(activityRange));
 const events=[...(local.events||[])];
 let coverage="Local operations";
 try{
  const github=await api("/api/local/actions/runs");
  if(github.connected){
   for(const run of github.runs||[]){
    const at=Date.parse(run.created_at||"");
    if(!Number.isFinite(at)||at<Date.parse(local.generatedAt)-{"24h":86400000,"7d":604800000,"30d":2592000000}[activityRange])continue;
    events.push({id:"github-"+run.id,type:"build",source:"github",title:run.name||"GitHub Actions",
     builderId:null,repository:run.repository,status:run.conclusion||run.status,
     time:new Date(at).toISOString(),url:run.url});
   }
   coverage+=" + GitHub Actions ("+(github.repositoriesScanned||0)+" repositories scanned)";
   if(github.partial)coverage+=" · GitHub history incomplete";
  }else coverage+=" · GitHub Actions not connected";
 }catch(e){coverage+=" · GitHub Actions unavailable";}
 activityData={...local,events};
 activitySelected=null;
 $("activityCoverage").textContent=coverage+
  " · Deployments and device flashes not yet tracked · Recent history only (up to "+
  local.retainedJobLimit+" local jobs and 50 GitHub runs).";
 renderActivityChart();
}
for(const button of document.querySelectorAll("[data-activity-range]")){
 button.addEventListener("click",()=>{
  activityRange=button.dataset.activityRange;
  for(const other of document.querySelectorAll("[data-activity-range]"))other.setAttribute("aria-pressed",String(other===button));
  loadActivity().catch(e=>$("activityChart").textContent="Unable to load activity: "+e.message);
 });
}

let refreshing=false;
async function load(){
 if(refreshing)return;
 refreshing=true;
 $("refresh").disabled=true;
 try{
  const [overview,projects,devices]=await Promise.all([
   api("/api/local/overview"),api("/api/local/projects"),api("/api/local/devices")]);
  $("username").textContent=overview.username||"administrator";
  $("workspaceOrg").textContent=overview.github?.organization||overview.github?.savedOrganization||"GitHub organization";
  statusText("projectCount",String(projects.repositories?.length||0));
  statusText("projectMeta",projects.updatedAt?"Synced "+relative(projects.updatedAt):"Not synced yet");
  const missing=(projects.repositories||[]).filter(p=>p.alert).length;
  const notice=$("builderCoverageNotice");notice.replaceChildren();
  if(missing){
   notice.append(element("span",missing+" active project"+(missing===1?" needs":"s need")+" a compatible build machine. "));
   const a=element("a","Review project requirements →","quiet-link");a.href="/projects?filter=missing";notice.append(a);
  }
  statusText("builderCount",String(overview.runners?.count||0));
  const online=(overview.runners?.items||[]).filter(r=>r.lastSeen&&Date.now()-Date.parse(r.lastSeen)<120000).length;
  statusText("builderMeta",online+" reporting recently");
  statusText("deviceCount",String(devices.summary?.connected||0));
  statusText("deviceMeta",String(devices.summary?.offline||0)+" offline · "+String(devices.summary?.hidden||0)+" hidden");
  statusText("jobCount",String(overview.jobs?.count||0));
  statusText("jobMeta",String(overview.jobs?.running||0)+" running · "+String(overview.jobs?.pending||0)+" approvals");
  statusText("gitStatus",overview.github?.identityConnected&&overview.github?.organization?
   "GitHub: "+overview.github.organization:overview.github?.authorizationExpired?"GitHub: reconnect required":"GitHub: not connected");
  statusText("aiStatus",overview.topology?.remoteMcpVerified?"Connected":"Not connected");
  statusText("tunnelCount",String(overview.topology?.verifiedTunnelCount??0));
  statusText("agentCount",String(overview.assistant?.connectedAgents??0));
  activityBuilders=overview.runners?.items||[];
  await loadActivity();
  renderJobs(overview.jobs?.recent||[]);
  renderProjects(projects);
  renderBuilders(overview);
  renderDevices(devices);
  $("statusMessage").textContent="";
  $("updatedAt").textContent="Updated "+new Date().toLocaleTimeString()+" · Auto-refresh every 30s";
 }catch(e){$("statusMessage").textContent=e.message;}
 finally{refreshing=false;$("refresh").disabled=false;}
}
$("refresh").addEventListener("click",load);
load();
setInterval(()=>{if(!document.hidden)load();},30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)load();});