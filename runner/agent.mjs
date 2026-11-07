import {readFileSync,writeFileSync,mkdirSync,chmodSync,statSync,realpathSync,readdirSync} from "node:fs";
import {join,resolve,isAbsolute,sep} from "node:path";
import {homedir,hostname,platform,arch,cpus,totalmem,freemem,uptime} from "node:os";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";

const configDir=process.env.TT_RUNNER_STATE_DIR||join(homedir(),".tinkertunnel");
const path=join(configDir,"runner.json");
const command=process.argv[2]||"run",endpoint=process.env.TT_CONTROLLER_URL||"http://portal:3000";
const os={win32:"windows",darwin:"macos",linux:"linux"}[platform()];
const architecture={x64:"x64",arm64:"arm64"}[arch()];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function ensureUrl(){
 const u=new URL(endpoint);
 if(!["https:","http:"].includes(u.protocol))throw new Error("Unsupported controller scheme");
 if(u.protocol==="http:"&&!["127.0.0.1","localhost","portal","controller"].includes(u.hostname)&&process.env.TT_ALLOW_INSECURE_LAN!=="true")
  throw new Error("Use HTTPS for remote controller or explicitly permit isolated LAN HTTP");
 return u;
}
async function post(route,obj,token){
 const origin=ensureUrl(),url=new URL(route,origin);
 if(url.origin!==origin.origin)throw new Error("Cross-origin controller URL rejected");
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",
  ...(token?{authorization:"Bearer "+token}:{})},body:JSON.stringify(obj),signal:AbortSignal.timeout(30000)});
 const data=await response.json().catch(()=>({error:"Unexpected controller response"}));
 if(!response.ok)throw new Error("Controller HTTP "+response.status+" ("+(data.error||"request rejected")+")");
 return data;
}
async function enroll(){
 if(!os||!architecture)throw new Error("Unsupported runner platform or architecture");
 const invite=process.env.TT_ENROLLMENT_TOKEN||"";
 if(invite.length<32)throw new Error("TT_ENROLLMENT_TOKEN required for enrollment");
 const name=(process.env.TT_RUNNER_NAME||hostname()).slice(0,64);
 const r=await post("/api/agent/enroll",{token:invite,name,os,arch:architecture});
 mkdirSync(configDir,{recursive:true,mode:0o700});
 writeFileSync(path,JSON.stringify({id:r.id,token:r.token,url:endpoint,name,os,arch:architecture},null,2),{mode:0o600});
 chmodSync(path,0o600);
 console.log("Enrolled "+name+" ("+r.id+") to "+endpoint+". Execution requires explicit controller and runner opt-in.");
}
function approvedCheckout(repo){
 if(process.env.TT_RUNNER_ENABLE_BUILDS!=="1")throw new Error("Runner builds disabled by operator");
 let projects;
 try{projects=JSON.parse(process.env.TT_RUNNER_PROJECTS_JSON||"{}");}
 catch{throw new Error("Invalid TT_RUNNER_PROJECTS_JSON");}
 if(!projects||typeof projects!=="object"||Array.isArray(projects)||
  !Object.hasOwn(projects,repo)||typeof projects[repo]!=="string")
  throw new Error("Repository not in this runner's approved local project map");
 const dir=projects[repo];
 if(!isAbsolute(dir))throw new Error("Project checkout must be an absolute path");
 const actual=realpathSync(resolve(dir));
 if(!statSync(actual).isDirectory())throw new Error("Checkout is not a directory");
 return actual;
}
async function processTool(bin,args,cwd,timeoutMs){
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,args,{cwd,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let combined="",wasKilled=false;
  const capture=chunk=>{combined+=(chunk?.toString("utf8")||"");if(combined.length>20000)combined=combined.slice(-20000);};
  child.stdout.on("data",capture);child.stderr.on("data",capture);
  const timer=setTimeout(()=>{wasKilled=true;child.kill("SIGKILL");},timeoutMs);
  child.once("error",e=>{clearTimeout(timer);reject(new Error("Approved command failed: "+e.message));});
  child.once("close",code=>{clearTimeout(timer);
   if(wasKilled)return reject(new Error("Approved command timed out"));
   if(code!==0)return reject(new Error("Approved command failed (exit "+code+"): "+combined.slice(-4000)));
   resolve(combined);
  });
 });
}
async function uploadAsset(config,jobId,name,mime,data){
 if(!Buffer.isBuffer(data))data=Buffer.from(data);
 if(data.length<1||data.length>8*1024*1024)throw new Error("Artifact outside allowed size");
 const base={id:config.id,job_id:jobId};
 const begin=await post("/api/agent/assets",{...base,action:"begin",name,mime,size:data.length},config.token);
 const id=begin.asset.id,chunkSize=Math.min(48*1024,begin.max_chunk_bytes||48*1024);
 for(let off=0;off<data.length;off+=chunkSize){
  await post("/api/agent/assets",{...base,action:"chunk",asset_id:id,offset:off,
   content_base64:data.subarray(off,off+chunkSize).toString("base64")},config.token);
 }
 const digest=createHash("sha256").update(data).digest("hex");
 await post("/api/agent/assets",{...base,action:"finish",asset_id:id,sha256:digest},config.token);
 return id;
}
function gatherFirmware(dir){
 const build=join(dir,"build"),items=[];
 try{
  for(const name of readdirSync(build)){
   if(!name.endsWith(".bin")||!/^[A-Za-z0-9_.-]+\.bin$/.test(name))continue;
   const file=realpathSync(join(build,name));
   if(!file.startsWith(realpathSync(build)+sep))continue;
   const stat=statSync(file);if(!stat.isFile()||stat.size<1||stat.size>8*1024*1024)continue;
   items.push({name,data:readFileSync(file)});
   if(items.length>=5)break;
  }
 }catch(e){if(e.code!=="ENOENT")throw e;}
 return items;
}
async function executeJob(config,job){
 const results=[],out=[],ids=[],steps=job.steps||[];
 let failed=false;
 for(const step of steps){
  if(failed){results.push({capability:step.capability,status:"skipped"});continue;}
  try{
   if(step.capability==="host.snapshot"){
    const report={host:config.name,os,architecture,hostname:hostname(),cpus:cpus().length,
     totalMemoryBytes:totalmem(),freeMemoryBytes:freemem(),uptimeSeconds:Math.floor(uptime()),
     node:process.version,observedAt:new Date().toISOString()};
    out.push("Host snapshot recorded");
    ids.push(await uploadAsset(config,job.id,"host-snapshot.json","application/json",
     Buffer.from(JSON.stringify(report,null,2))));
   }else if(step.capability==="firmware.esp_idf.build"){
    const repo=job.parameters?.repository;
    if(typeof repo!=="string")throw new Error("Repository missing");
    const checkout=approvedCheckout(repo);
    if(typeof job.parameters?.revision!=="string"||!/^[a-f0-9]{40}$/i.test(job.parameters.revision))
     throw new Error("An exact Git revision must be approved before building");
    const actual=(await processTool("git",["rev-parse","HEAD"],checkout,20000)).trim();
    if(actual.toLowerCase()!==job.parameters.revision.toLowerCase())
     throw new Error("Checkout revision differs from approved plan; update the checkout separately");
    const dirty=(await processTool("git",["status","--porcelain=v1","--untracked-files=normal"],checkout,20000)).trim();
    if(dirty)throw new Error("Approved checkout has modified or untracked files; use a clean pinned checkout");
    // No user-provided executable, flags, environment, working directory, URL or command string.
    const output=await processTool(process.env.TT_RUNNER_IDF_CMD||"idf.py",["-C",checkout,"build"],
     checkout,20*60*1000);
    out.push(output.slice(-14000));
    ids.push(await uploadAsset(config,job.id,"esp-idf-build-log.txt","text/plain",
     Buffer.from(output||"Build completed")));
    for(const artifact of gatherFirmware(checkout))
     ids.push(await uploadAsset(config,job.id,artifact.name,"application/octet-stream",artifact.data));
   }else throw new Error("Runner does not support capability "+step.capability);
   results.push({capability:step.capability,status:"completed"});
  }catch(e){
   failed=true;out.push("Step "+step.capability+" failed: "+e.message);
   results.push({capability:step.capability,status:"failed"});
  }
 }
 const logs=out.join("\n").slice(-24000);
 await post("/api/agent/jobs/complete",{id:config.id,job_id:job.id,success:!failed,
  logs,steps:results,asset_ids:ids},config.token);
 console.log("Job "+job.id+" "+(failed?"failed":"completed")+"; artifacts "+ids.length);
}
async function run(){
 const config=JSON.parse(readFileSync(path,"utf8"));
 if(config.url!==endpoint)throw new Error("Controller URL does not match enrollment");
 console.log("Runner started: "+config.name+"; approved jobs only, no shell/flash actions");
 const heartbeat=setInterval(()=>{
  post("/api/agent/heartbeat",{id:config.id},config.token).catch(e=>console.error("Heartbeat:",e.message));
 },30000);
 try{
  for(;;){
   try{
    const response=await post("/api/agent/jobs/claim",{id:config.id},config.token);
    if(response.job)await executeJob(config,response.job);
   }catch(e){console.error("Runner polling:",e.message);}
   await sleep(10000);
  }
 }finally{clearInterval(heartbeat);}
}
try{
 if(command==="enroll")await enroll();
 else if(command==="run")await run();
 else throw new Error("Usage: node agent.mjs enroll|run");
}catch(e){console.error("Runner error:",e.message);process.exitCode=1;}
