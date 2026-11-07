import {readFileSync,writeFileSync,mkdirSync,chmodSync} from "node:fs";
import {join} from "node:path";
import {homedir,hostname,platform,arch} from "node:os";

const configDir=process.env.TT_RUNNER_STATE_DIR||join(homedir(),".tinkertunnel");
const path=join(configDir,"runner.json");
const command=process.argv[2]||"run";
const endpoint=process.env.TT_CONTROLLER_URL||"http://portal:3000";
const os={win32:"windows",darwin:"macos",linux:"linux"}[platform()];
const architecture={x64:"x64",arm64:"arm64"}[arch()];
function ensureUrl() {
 const u=new URL(endpoint);
 if(!["https:","http:"].includes(u.protocol))throw new Error("Unsupported controller scheme");
 if(u.protocol==="http:"&&!["127.0.0.1","localhost","portal","controller"].includes(u.hostname) && process.env.TT_ALLOW_INSECURE_LAN!=="true")
   throw new Error("Use HTTPS for remote controller, or explicitly TT_ALLOW_INSECURE_LAN=true on trusted isolated networks");
 return u;
}
async function post(route,obj,token){
 const origin=ensureUrl();
 const url=new URL(route,origin);
 if(url.origin!==origin.origin)throw new Error("Cross-origin controller URL rejected");
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},body:JSON.stringify(obj),signal:AbortSignal.timeout(10000)});
 const body=await response.json();
 if(!response.ok)throw new Error("Controller HTTP "+response.status+" ("+(body.error||"request rejected")+")");
 return body;
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
 console.log("Enrolled "+name+" ("+r.id+") to "+endpoint+". Job execution remains disabled.");
}
async function run(){
 const config=JSON.parse(readFileSync(path,"utf8"));
 if(config.url!==endpoint)throw new Error("TT_CONTROLLER_URL must match enrolled controller URL");
 console.log("Runner heartbeat started: "+config.name+" | execution disabled");
 for(;;){
   try {await post("/api/agent/heartbeat",{id:config.id},config.token);}
   catch(e){console.error("Heartbeat failed:",e.message);}
   await new Promise(resolve=>setTimeout(resolve,30000));
 }
}
try{
 if(command==="enroll")await enroll();
 else if(command==="run")await run();
 else throw new Error("Usage: node agent.mjs enroll|run");
}catch(e){console.error("Runner error:",e.message);process.exitCode=1;}
