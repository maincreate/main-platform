#!/usr/bin/env node
/**
 * Outbound Host Service pairing.
 *
 * The host connects to the HTTPS controller, announces a persistent Ed25519
 * public key, and shows its fingerprint and a pairing URL. A logged-in controller
 * administrator compares the same fingerprint and explicitly approves the host.
 * No local HTTP listener, network scanning, SSH or host password is required.
 */
import {spawn} from "node:child_process";
import {createInterface} from "node:readline/promises";
import {generateKeyPairSync,createPublicKey,createPrivateKey,createHash,sign} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,chmodSync,existsSync} from "node:fs";
import {join} from "node:path";
import {homedir,hostname,platform,arch} from "node:os";
import {fileURLToPath} from "node:url";

const stateDir=process.env.TT_RUNNER_STATE_DIR||join(homedir(),".tinkertunnel");
const statePath=join(stateDir,"runner.json");
const identityPath=join(stateDir,"host-identity.json");
const agent=fileURLToPath(new URL("./agent.mjs",import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const error=message=>Object.assign(new Error(message),{code:"PAIRING_FAILED"});
const os={win32:"windows",darwin:"macos",linux:"linux"}[platform()];
const architecture={x64:"x64",arm64:"arm64"}[arch()];

export function controllerAddress(input){
 let url;
 try{url=new URL(String(input||"").trim());}catch{throw error("Enter a valid controller URL");}
 if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash)
  throw error("Use the HTTPS controller origin without a path or embedded credentials");
 return url.origin;
}
function identity(){
 mkdirSync(stateDir,{recursive:true,mode:0o700});
 let value;
 if(existsSync(identityPath)){
  value=JSON.parse(readFileSync(identityPath,"utf8"));
 }else{
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  value={
   privateKey:privateKey.export({format:"der",type:"pkcs8"}).toString("base64"),
   publicKey:publicKey.export({format:"der",type:"spki"}).toString("base64")
  };
  writeFileSync(identityPath,JSON.stringify(value),{mode:0o600,flag:"wx"});
 }
 const privateKey=createPrivateKey({key:Buffer.from(value.privateKey,"base64"),format:"der",type:"pkcs8"});
 const publicKey=createPublicKey(privateKey).export({format:"der",type:"spki"}).toString("base64");
 if(publicKey!==value.publicKey)throw error("Stored host identity does not match its public key");
 chmodSync(identityPath,0o600);
 return {privateKey,publicKey,fingerprint:"SHA256:"+createHash("sha256")
  .update(Buffer.from(publicKey,"base64")).digest("base64").replace(/=+$/,"")};
}
function signature(key,phase,values){
 return sign(null,Buffer.from("tinkertunnel-host-"+phase+"-v1\n"+values.join("\n")),key).toString("base64");
}
async function request(origin,route,data){
 const response=await fetch(origin+route,{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw error("Controller rejected pairing: "+(result.error||"HTTP "+response.status));
 return result;
}
export function pairingLink(origin,id){
 if(!/^[a-f0-9]{32}$/.test(id))throw error("Invalid pairing ID");
 return controllerAddress(origin)+"/builders?add=1&pair="+id;
}
async function pair(){
 if(!process.stdin.isTTY)throw error("Pairing needs an interactive terminal");
 if(!os||!architecture)throw error("Unsupported host OS or CPU architecture");
 if(existsSync(statePath))throw error("This host is already enrolled. Run 'node runner/service.mjs run'.");
 const rl=createInterface({input:process.stdin,output:process.stdout});
 let origin;
 try{origin=controllerAddress(await rl.question("Controller HTTPS URL: "));}
 finally{rl.close();}
 const host=identity(),name=hostname().slice(0,64).replace(/[^A-Za-z0-9_.-]/g,"-");
 const announce=await request(origin,"/api/host/pair/announce",
  {name,os,arch:architecture,publicKey:host.publicKey});
 let nonce=announce.nonce;
 console.log("\nHost:",name,"("+os+"/"+architecture+")");
 console.log("Host identity fingerprint:",host.fingerprint);
 console.log("Open this URL in an authenticated controller browser:");
 console.log(pairingLink(origin,announce.id));
 console.log("Pairing ID:",announce.id);
 console.log("Verify the fingerprint shown on the controller matches this terminal before approving.");
 console.log("Waiting for controller approval (up to 10 minutes)...");
 const expires=Date.now()+Math.min(600,Number(announce.expiresInSeconds)||600)*1000;
 let invitation;
 while(Date.now()<expires){
  await pause(3000);
  let status;
  try{
   status=await request(origin,"/api/host/pair/poll",{
    id:announce.id,signature:signature(host.privateKey,"poll",[announce.id,nonce])
   });
  }catch(e){
   // Network errors are transient. Authentication or expired pairing stops.
   if(e.code==="PAIRING_FAILED"&&e.message.includes("Controller rejected"))throw e;
   console.error("Controller connection unavailable; retrying...");
   continue;
  }
  nonce=status.nonce;
  if(status.state==="approved"){invitation=status.enrollmentToken;break;}
  if(status.state!=="pending"||typeof nonce!=="string")throw error("Invalid pairing state");
 }
 if(typeof invitation!=="string"||invitation.length<32)throw error("Pairing expired. Run pair again.");
 const enrollmentSignature=signature(host.privateKey,"enroll",[invitation,name,os,architecture]);
 const child=spawn(process.execPath,[agent,"enroll"],{
  stdio:"inherit",env:{...process.env,TT_CONTROLLER_URL:origin,TT_ENROLLMENT_TOKEN:invitation,
   TT_PAIRING_PUBLIC_KEY:host.publicKey,TT_PAIRING_ENROLL_SIGNATURE:enrollmentSignature}});
 const exitCode=await new Promise((resolve,reject)=>{
  child.once("error",reject);child.once("exit",code=>resolve(code??1));
 });
 if(exitCode!==0)throw error("Host agent enrollment failed");
 console.log("Paired successfully. Start with: node runner/service.mjs run");
}
function run(){
 if(!existsSync(statePath))throw error("Host is not paired. Run the 'pair' command first.");
 const config=JSON.parse(readFileSync(statePath,"utf8"));
 const origin=controllerAddress(config.url);
 const child=spawn(process.execPath,[agent,"run"],{
  stdio:"inherit",env:{...process.env,TT_CONTROLLER_URL:origin}});
 for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
 child.once("exit",code=>{process.exitCode=code??1;});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const command=process.argv[2];
 try{
  if(command==="pair")await pair();
  else if(command==="run")run();
  else throw error("Usage: node runner/service.mjs pair | run");
 }catch(e){console.error("TinkerTunnel Host Service: "+e.message);process.exitCode=1;}
}
