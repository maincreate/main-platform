import {randomBytes,createHash} from "node:crypto";
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,chmodSync,openSync,writeSync,readSync,closeSync,statSync,rmSync} from "node:fs";
import {join} from "node:path";

const root=process.env.TT_DATA_DIR||"./.tinkertunnel-data";
const database=join(root,"fabric.json"),assetDir=join(root,"assets");
const MAX_ASSET=8*1024*1024,MAX_CHUNK=48*1024,MAX_STORED=80*1024*1024;
// The MCP surface is stable. These versioned, curated files define what it can discover.
// Only adapters implemented in the runner may be marked executable.
const readManifest=name=>JSON.parse(readFileSync(new URL("../registry/"+name,import.meta.url),"utf8"));
const CAPS=readManifest("capabilities.json");
const TOOLKITS=readManifest("toolkits.json");
const RUNNER_ADAPTERS=new Set(["host.snapshot","firmware.esp_idf.build"]);
function validateRegistry(){
 const ids=new Set();
 for(const c of CAPS){
  if(!c||typeof c.id!=="string"||!/^[a-z][a-z0-9_.]+$/.test(c.id)||ids.has(c.id)||
    typeof c.version!=="string"||!/^\d+\.\d+\.\d+$/.test(c.version)||
    !["action","workflow"].includes(c.kind)||!["available","unavailable"].includes(c.state)||
    !Array.isArray(c.steps)||c.steps.length>8||!Array.isArray(c.platforms)||
    !c.parameters||c.parameters.type!=="object")
   throw new Error("Invalid or duplicate capability manifest");
  if(c.state==="available"&&
     (c.steps.length===0||c.steps.some(st=>!RUNNER_ADAPTERS.has(st.capability))))
   throw new Error("Capability cannot be enabled without a reviewed runner adapter");
  ids.add(c.id);
 }
}
validateRegistry();
const uid=()=>randomBytes(16).toString("hex");
const sha=x=>createHash("sha256").update(x).digest("hex");
const error=(code,message)=>Object.assign(new Error(message),{status:code});
function store(){if(!existsSync(database))return {version:1,plans:[],jobs:[],assets:[]};
 const s=JSON.parse(readFileSync(database,"utf8"));
 if(s.version!==1||!Array.isArray(s.plans)||!Array.isArray(s.jobs)||!Array.isArray(s.assets))
  throw error(500,"Invalid fabric state");
 return s;
}
function save(s){
 mkdirSync(root,{recursive:true,mode:0o700});
 const temp=join(root,".fabric-"+uid());
 writeFileSync(temp,JSON.stringify(s),{mode:0o600,flag:"wx"});
 renameSync(temp,database);chmodSync(database,0o600);
}
const clean=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const bounded=(s,n=128)=>typeof s==="string"&&s.length>0&&s.length<=n;
function validParams(schema,input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw error(422,"parameters must be an object");
 const allowed=schema.properties||{};
 for(const k of Object.keys(input)){
  if(!Object.hasOwn(allowed,k))throw error(422,"Unsupported parameter: "+k);
  if(typeof input[k]!=="string"||input[k].length>256||!new RegExp(allowed[k].pattern||"^.*$").test(input[k]))
   throw error(422,"Invalid parameter: "+k);
 }
 for(const k of schema.required||[])if(!Object.hasOwn(input,k))throw error(422,"Missing parameter: "+k);
 return Object.fromEntries(Object.entries(input));
}
function manifest(id){return CAPS.find(c=>c.id===id);}
function runnerBy(ctx,id){return (ctx.runners||[]).find(r=>r.id===id);}
function publicJob(j){return {id:j.id,plan_id:j.planId,capability:j.capability,runner_id:j.runnerId,
 status:j.status,created_at:j.createdAt,approved_at:j.approvedAt||null,started_at:j.startedAt||null,
 completed_at:j.completedAt||null,steps:j.steps,logs:j.logs||"",asset_ids:j.assetIds||[],
 error:j.error||null};}
function publicAsset(a){return {id:a.id,name:a.name,mime:a.mime,size:a.size,received:a.received,
 complete:a.complete,sha256:a.complete?a.sha256:null,job_id:a.jobId||null};}
const recent=r=>r?.lastSeen&&Date.now()-Date.parse(r.lastSeen)<120000&&Date.now()-Date.parse(r.lastSeen)>-120000;
function createPlan(args,ctx) {
 const id=args.capability,cap=manifest(id);
 if(!cap||cap.state!=="available")throw error(422,"Capability is not available");
 if(!bounded(args.runner_id,80))throw error(422,"runner_id is required");
 const runner=runnerBy(ctx,args.runner_id);
 if(!runner)throw error(404,"Runner not enrolled");
 if(!cap.platforms.includes(runner.os))throw error(422,"Runner operating system not supported");
 const params=validParams(cap.parameters,clean(args.parameters));
 const s=store();s.plans=s.plans.filter(p=>Date.now()-Date.parse(p.createdAt)<24*3600e3).slice(-99);
 const p={id:uid(),capability:id,version:cap.version,runnerId:runner.id,parameters:params,
  steps:cap.steps.map((step,i)=>({index:i,capability:step.capability,status:"pending"})),
  createdAt:new Date().toISOString(),expiresAt:Date.now()+30*60e3};
 s.plans.push(p);save(s);
 return {plan_id:p.id,capability:p.capability,version:p.version,runner_id:p.runnerId,
  parameters:p.parameters,steps:p.steps,requires_approval:true,runner_online:!!recent(runner),
  expires_at:new Date(p.expiresAt).toISOString(),
  notice:"Planning does not execute. tt_execute creates an approval-pending job; approval must come from the signed-in portal."};
}
function createJob(args,ctx){
 const s=store(),p=s.plans.find(x=>x.id===args.plan_id);
 if(!p||Date.now()>p.expiresAt)throw error(404,"Plan missing or expired; re-plan");
 if(!runnerBy(ctx,p.runnerId))throw error(404,"Runner no longer enrolled");
 const existing=s.jobs.find(j=>j.planId===p.id);
 if(existing)return {job:publicJob(existing),created:false,requires_approval:existing.status==="awaiting_approval"};
 if(s.jobs.length>=200)throw error(409,"Job history limit reached; archive required");
 const j={id:uid(),planId:p.id,capability:p.capability,runnerId:p.runnerId,
  parameters:p.parameters,version:p.version,steps:p.steps.map(x=>({...x})),
  status:"awaiting_approval",createdAt:new Date().toISOString(),logs:"",assetIds:[]};
 s.jobs.push(j);save(s);
 return {job:publicJob(j),created:true,requires_approval:true,
  notice:"A signed-in administrator must approve this job in the TinkerTunnel portal before a runner can claim it."};
}
function inspect(args,ctx){
 const kind=args.resource||"capability",id=args.id;
 if(kind==="capability"){
  const c=manifest(id);
  if(!c)throw error(404,"Unknown capability");
  return c;
 }
 if(kind==="toolkit"){
  const t=TOOLKITS.find(x=>x.id===id);
  if(!t)throw error(404,"Unknown toolkit");
  return t;
 }
 if(kind==="runner"){
  const r=runnerBy(ctx,id);
  if(!r)throw error(404,"Unknown runner");
  return {id:r.id,name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen||null,online:!!recent(r)};
 }
 if(kind==="job"){
  const j=store().jobs.find(x=>x.id===id);
  if(!j)throw error(404,"Unknown job");
  return publicJob(j);
 }
 throw error(422,"Unknown resource type");
}
function discover(args,ctx){
 const resource=args.resource||"all",q=(args.query||"").toLowerCase();
 if(!["all","capabilities","toolkits","runners","workspace","jobs","assets"].includes(resource))
  throw error(422,"Unknown resource type");
 const result={};
 if(resource==="all"||resource==="capabilities")result.capabilities=CAPS.filter(x=>!q||(x.id+" "+x.description).toLowerCase().includes(q));
 if(resource==="all"||resource==="toolkits")result.toolkits=TOOLKITS.filter(t=>!q||(t.id+" "+t.description).toLowerCase().includes(q));
 if(resource==="all"||resource==="runners")result.runners=(ctx.runners||[]).map(r=>({
  id:r.id,name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen||null,online:!!recent(r)
 })).filter(x=>!q||(x.name+" "+x.os).toLowerCase().includes(q));
 if(resource==="all"||resource==="workspace")result.workspace=ctx.workspace||{name:"TinkerTunnel"};
 if(resource==="jobs")result.jobs=store().jobs.slice(-30).reverse().map(publicJob);
 if(resource==="assets")result.assets=store().assets.filter(x=>x.complete).map(publicAsset);
 return result;
}
function jobs(args) {
 const s=store(),action=args.action||"list";
 if(action==="list")return {jobs:s.jobs.slice(-50).reverse().map(publicJob)};
 const j=s.jobs.find(x=>x.id===args.job_id);
 if(!j)throw error(404,"Job not found");
 if(action==="get"||action==="logs")return action==="get"?{job:publicJob(j)}:
  {id:j.id,status:j.status,logs:j.logs||"",steps:j.steps};
 if(action==="cancel"){
  if(!["awaiting_approval","queued"].includes(j.status))throw error(409,"Only unclaimed jobs may be cancelled");
  j.status="cancelled";j.completedAt=new Date().toISOString();save(s);
  return {job:publicJob(j)};
 }
 throw error(422,"Unknown job action");
}
function assetFile(id){if(!/^[a-f0-9]{32}$/.test(id))throw error(422,"Invalid asset identifier");return join(assetDir,id);}
function beginAsset(args,{jobId=null}={}){
 const size=args.size;
 if(!Number.isSafeInteger(size)||size<1||size>MAX_ASSET)throw error(422,"Invalid asset size");
 if(!bounded(args.name,120)||!awaitName(args.name))throw error(422,"Invalid filename");
 const s=store();
 if(s.assets.length>=100||s.assets.reduce((acc,a)=>acc+a.size,0)+size>MAX_STORED)
  throw error(409,"Asset quota reached");
 if(jobId&&!s.jobs.some(j=>j.id===jobId&&j.status==="running"))throw error(409,"Job not running");
 const asset={id:uid(),name:args.name,mime:bounded(args.mime,80)?args.mime:"application/octet-stream",
  size,received:0,complete:false,createdAt:new Date().toISOString(),jobId};
 mkdirSync(assetDir,{recursive:true,mode:0o700});
 const fd=openSync(assetFile(asset.id),"wx",0o600);closeSync(fd);
 s.assets.push(asset);save(s);return {asset:publicAsset(asset),max_chunk_bytes:MAX_CHUNK};
}
const awaitName=s=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(s)&&!s.includes("..");
function chunkAsset(args){
 const s=store(),a=s.assets.find(x=>x.id===args.asset_id);
 if(!a||a.complete)throw error(404,"Open asset not found");
 if(!Number.isSafeInteger(args.offset)||args.offset!==a.received)throw error(409,"Upload offset mismatch");
 if(typeof args.content_base64!=="string"||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.content_base64))
  throw error(422,"Invalid base64 upload");
 const chunk=Buffer.from(args.content_base64,"base64");
 if(chunk.length<1||chunk.length>MAX_CHUNK||a.received+chunk.length>a.size)
  throw error(422,"Upload chunk size exceeds bounds");
 const fd=openSync(assetFile(a.id),"r+");
 try{writeSync(fd,chunk,0,chunk.length,a.received);}finally{closeSync(fd);}
 a.received+=chunk.length;save(s);
 return {asset_id:a.id,received:a.received,remaining:a.size-a.received};
}
function finishAsset(args){
 const s=store(),a=s.assets.find(x=>x.id===args.asset_id);
 if(!a)throw error(404,"Asset not found");
 if(a.complete)return {asset:publicAsset(a)};
 if(a.received!==a.size)throw error(409,"Asset upload incomplete");
 const hash=sha(readFileSync(assetFile(a.id)));
 if(args.sha256&&args.sha256!==hash)throw error(422,"Asset digest mismatch");
 a.complete=true;a.sha256=hash;save(s);
 if(a.jobId){
  const j=s.jobs.find(x=>x.id===a.jobId);
  if(j&&!j.assetIds.includes(a.id)){j.assetIds.push(a.id);save(s);}
 }
 return {asset:publicAsset(a)};
}
function getAsset(args){
 const a=store().assets.find(x=>x.id===args.asset_id&&x.complete);
 if(!a)throw error(404,"Asset not found");
 const offset=args.offset??0,length=args.length??MAX_CHUNK;
 if(!Number.isSafeInteger(offset)||offset<0||offset>a.size||
  !Number.isSafeInteger(length)||length<1||length>MAX_CHUNK)
  throw error(422,"Invalid range");
 const chunk=Buffer.alloc(Math.min(length,a.size-offset));
 const fd=openSync(assetFile(a.id),"r");
 let bytes;
 try{bytes=readSync(fd,chunk,0,chunk.length,offset);}finally{closeSync(fd);}
 if(bytes!==chunk.length)throw error(503,"Asset file truncated");
 return {asset:publicAsset(a),offset,content_base64:chunk.toString("base64"),next_offset:offset+bytes,
  complete:offset+bytes>=a.size};
}
function assets(args){
 switch(args.action||"list"){
  case "list":return {assets:store().assets.filter(x=>x.complete&&(!args.job_id||x.jobId===args.job_id)).map(publicAsset)};
  case "begin":return beginAsset(args);
  case "chunk":return chunkAsset(args);
  case "finish":return finishAsset(args);
  case "get":return getAsset(args);
  default:throw error(422,"Unknown assets action");
 }
}
export function fabricCall(tool,raw,ctx={}){
 const args=clean(raw);
 switch(tool){
  case "tt_discover":return discover(args,ctx);
  case "tt_inspect":return inspect(args,ctx);
  case "tt_plan":return createPlan(args,ctx);
  case "tt_execute":return createJob(args,ctx);
  case "tt_jobs":return jobs(args);
  case "tt_assets":return assets(args);
  default:throw error(404,"Unknown fabric tool");
 }
}
export function approveJob(id,decision){
 const s=store(),j=s.jobs.find(x=>x.id===id);
 if(!j)throw error(404,"Job not found");
 if(j.status!=="awaiting_approval")throw error(409,"Job already handled");
 if(!["approve","reject"].includes(decision))throw error(422,"Invalid decision");
 j.status=decision==="approve"?"queued":"rejected";
 j.approvedAt=decision==="approve"?new Date().toISOString():null;
 if(decision==="reject")j.completedAt=new Date().toISOString();
 save(s);return {job:publicJob(j)};
}
export function claimJob(runner){
 const s=store();
 if(s.jobs.some(j=>j.runnerId===runner.id&&j.status==="running"))return {job:null};
 const j=s.jobs.find(x=>x.runnerId===runner.id&&x.status==="queued");
 if(!j)return {job:null};
 j.status="running";j.startedAt=new Date().toISOString();
 j.steps=j.steps.map(x=>({...x,status:"pending"}));
 save(s);
 return {job:{id:j.id,capability:j.capability,parameters:j.parameters,steps:j.steps,
  version:j.version}};
}
export function reportJob(runner,args){
 const s=store(),j=s.jobs.find(x=>x.id===args.job_id);
 if(!j||j.runnerId!==runner.id||j.status!=="running")throw error(409,"No claimed job for runner");
 if(typeof args.success!=="boolean")throw error(422,"success must be boolean");
 if(typeof args.logs!=="string"||args.logs.length>24000)throw error(422,"Logs exceed limit");
 const steps=Array.isArray(args.steps)?args.steps:[];
 if(steps.length!==j.steps.length||steps.some((step,i)=>step.capability!==j.steps[i].capability||
   !["completed","failed","skipped"].includes(step.status)))
  throw error(422,"Invalid job step results");
 if((args.success&&!steps.every(step=>step.status==="completed"))||
   (!args.success&&!steps.some(step=>step.status==="failed")))
  throw error(422,"Reported status and step outcomes disagree");
 j.logs=args.logs;j.steps=steps.map((st,i)=>({index:i,capability:st.capability,status:st.status}));
 j.status=args.success?"completed":"failed";
 j.completedAt=new Date().toISOString();
 j.error=args.success?null:"Runner reported execution failure";
 save(s);
 return {job:publicJob(j)};
}
export function agentAsset(runner,args){
 const jobId=args.job_id,s=store(),j=s.jobs.find(x=>x.id===jobId);
 if(!j||j.runnerId!==runner.id||j.status!=="running")throw error(403,"Runner does not own this running job");
 if(args.action==="begin")return beginAsset(args,{jobId});
 const asset=s.assets.find(a=>a.id===args.asset_id&&a.jobId===jobId);
 if(!asset)throw error(403,"Asset not owned by running job");
 if(args.action==="chunk")return chunkAsset(args);
 if(args.action==="finish")return finishAsset(args);
 throw error(422,"Invalid runner asset action");
}
export function fabricStats(){
 const s=store();return {capabilities:CAPS.length,jobs:s.jobs.length,assets:s.assets.length};
}
