#!/usr/bin/env node
/**
 * Main{Create} Host Service — local-first enrollment and outbound management.
 *
 * Pair from the host with: node runner/service.mjs pair
 * Run after pairing:     node runner/service.mjs run
 *
 * No inbound SSH listener, no server-admin password retained, and no remote
 * arbitrary-command interface. The existing bounded agent performs polling.
 */
import {spawn} from "node:child_process";
import {createInterface} from "node:readline/promises";
import {Writable} from "node:stream";
import {readFileSync,existsSync} from "node:fs";
import {join} from "node:path";
import {homedir} from "node:os";
import {fileURLToPath} from "node:url";

const stateDir=process.env.MAIN_RUNNER_STATE_DIR||join(homedir(),".tinkertunnel");
const statePath=join(stateDir,"runner.json");
const agent=fileURLToPath(new URL("./agent.mjs",import.meta.url));
const error=(message)=>Object.assign(new Error(message),{code:"PAIRING_FAILED"});

export function controllerAddress(input){
 let url;
 try{url=new URL(String(input||"").trim());}catch{throw error("Enter a valid controller URL");}
 if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash)
  throw error("Use the HTTPS controller origin (without a path or embedded credentials)");
 return url.origin;
}
export function identityName(username){
 if(typeof username!=="string"||!/^[a-zA-Z0-9_.-]{1,64}$/.test(username))throw error("Enter a valid administrator username");
 return username;
}
async function request(url,method,body,sessionCookie,csrf){
 const response=await fetch(url,{method,
  headers:{"content-type":"application/json",...(sessionCookie?{cookie:sessionCookie}:{ }),
   ...(csrf?{"x-tt-csrf":csrf}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw error("Controller rejected pairing: "+(result.error||"HTTP "+response.status));
 return {response,result};
}
export async function requestInvitation(origin,username,password,transport=request){
 const user=identityName(username);
 if(typeof password!=="string"||password.length<1)throw error("Administrator password is required");
 // The password is sent only over the validated HTTPS origin, then discarded.
 const login=await transport(origin+"/api/local/login","POST",{username:user,password});
 const cookie=(login.response.headers.get("set-cookie")||"").split(";")[0];
 if(!/^ttsid=[a-f0-9]{64}$/.test(cookie)||typeof login.result.csrf!=="string")
  throw error("Controller login did not issue a pairing session");
 const invite=await transport(origin+"/api/local/runners/invite","POST",{},cookie,login.result.csrf);
 if(typeof invite.result.token!=="string"||invite.result.token.length<32)
  throw error("Controller did not issue a valid one-time enrollment token");
 try{await transport(origin+"/api/local/logout","POST",{},cookie,login.result.csrf);}catch{}
 return invite.result.token;
}
async function prompts(){
 let conceal=false;
 const output=new Writable({write(chunk,encoding,callback){if(!conceal)process.stdout.write(chunk);callback();}});
 const rl=createInterface({input:process.stdin,output,terminal:true});
 try{
  const address=await rl.question("Controller URL (https://...): ");
  const username=await rl.question("Main{Create} administrator username: ");
  process.stdout.write("Password: ");conceal=true;
  const password=await rl.question("");
  conceal=false;process.stdout.write("\n");
  return {address,username,password};
 }finally{rl.close();}
}
async function pair(){
 if(!process.stdin.isTTY)throw error("Pairing requires an interactive terminal; credentials cannot be passed as arguments");
 const {address,username,password}=await prompts();
 const origin=controllerAddress(address);
 const token=await requestInvitation(origin,username,password);
 const child=spawn(process.execPath,[agent,"enroll"],{
  stdio:"inherit",env:{...process.env,MAIN_CONTROLLER_URL:origin,MAIN_ENROLLMENT_TOKEN:token}});
 const exitCode=await new Promise((resolve,reject)=>{
  child.once("error",reject);child.once("exit",code=>resolve(code??1));
 });
 if(exitCode!==0)throw error("Host agent enrollment failed");
 process.stdout.write("Paired successfully. Run 'node runner/service.mjs run' or install it as an OS service.\n");
}
function run(){
 if(!existsSync(statePath))throw error("Host is not paired. Run the 'pair' command first.");
 const config=JSON.parse(readFileSync(statePath,"utf8"));
 const origin=controllerAddress(config.url);
 const child=spawn(process.execPath,[agent,"run"],{
  stdio:"inherit",env:{...process.env,MAIN_CONTROLLER_URL:origin}});
 for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
 child.once("exit",code=>{process.exitCode=code??1;});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const command=process.argv[2];
 try{
  if(command==="pair")await pair();
  else if(command==="run")run();
  else throw error("Usage: node runner/service.mjs pair | run");
 }catch(e){console.error("Main{Create} Host Service: "+e.message);process.exitCode=1;}
}
