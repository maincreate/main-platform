/**
 * Main{Create} self-hosted private MCP transport.
 *
 * Admin-controlled, outbound-only OpenAI tunnel. Secrets are encrypted in the
 * controller state; during execution they are materialized ONLY as mode 0600
 * ephemeral files inside the portal container, never in process arguments.
 * The MCP gateway listens exclusively on loopback and cannot be reached from
 * the LAN or through the public application proxy.
 */
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const appRoot=fileURLToPath(new URL("../",import.meta.url));
const clientPath="/usr/bin/tunnel-client";
const gatewayPort=18191,healthPort=18192;
const gatewayURL="http://127.0.0.1:"+gatewayPort;
const healthURL="http://127.0.0.1:"+healthPort;
const serviceToken=randomBytes(32).toString("hex");
const mcpToken=randomBytes(32).toString("hex");
let gateway=null,client=null,workDir=null,lastError=null,startedAt=null;
let serial=Promise.resolve();

export const internalMcpServiceToken=()=>serviceToken;
export const validOpenAiTunnelId=id=>typeof id==="string"&&
 /^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(id);
export const validOpenAiRuntimeKey=value=>typeof value==="string"&&
 value.length>=24&&value.length<=512&&value.startsWith("sk-")&&
 !/[\s\u0000-\u001f\u007f]/.test(value);
export const tunnelClientVersion="v0.0.19";

const alive=p=>!!p&&p.exitCode===null&&p.signalCode===null&&!p.killed;
function enqueue(operation){
 const next=serial.then(operation,operation);
 serial=next.catch(()=>{});
 return next;
}
async function terminate(p){
 if(!p||p.exitCode!==null||p.signalCode!==null)return;
 await new Promise(resolve=>{
  let finished=false,timeout;
  const done=()=>{if(finished)return;finished=true;if(timeout)clearTimeout(timeout);resolve();};
  p.once("exit",done);
  p.once("error",done);
  try{p.kill("SIGTERM");}catch{done();return;}
  timeout=setTimeout(()=>{if(!finished){try{p.kill("SIGKILL");}catch{}done();}},1500);
  timeout.unref?.();
 });
}
async function probe(url){
 try{
  const r=await fetch(url,{signal:AbortSignal.timeout(1250),headers:{accept:"application/json"}});
  if(!r.ok)return false;
  const data=await r.json().catch(()=>({}));
  return data?.ready===false?false:data?.ok===false?false:true;
 }catch{return false;}
}
async function discoverLocalMcp(){
 try{
  const response=await fetch(gatewayURL+"/mcp",{
   method:"POST",signal:AbortSignal.timeout(1250),
   headers:{
    "x-maincreate-private-token":mcpToken,
    accept:"application/json, text/event-stream",
    "content-type":"application/json"
   },
   body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}})
  });
  if(!response.ok)return false;
  const body=await response.json();
  return Array.isArray(body?.result?.tools)&&body.result.tools.length>0;
 }catch{return false;}
}
async function ensureGateway(){
 if(alive(gateway)&&await probe(gatewayURL+"/healthz")&&await discoverLocalMcp())return;
 if(gateway)await terminate(gateway);
 gateway=spawn(process.execPath,[join(appRoot,"gateway/server.mjs")],{
  cwd:appRoot,env:{
   ...process.env,HOST:"127.0.0.1",PORT:String(gatewayPort),
   MAIN_CONTROLLER_URL:"http://127.0.0.1:"+String(process.env.PORT||"3000"),
   MAIN_SERVICE_TOKEN:serviceToken,MAIN_PRIVATE_MCP_TOKEN:mcpToken
  },stdio:["ignore","ignore","ignore"],shell:false
 });
 gateway.on("error",()=>{lastError="Could not start the private MCP server.";});
 gateway.on("exit",(code,signal)=>{
  if(code!==0&&signal!=="SIGTERM"&&signal!=="SIGKILL")
   lastError="Private MCP server stopped unexpectedly.";
 });
 for(let i=0;i<16;i++){
  if(await probe(gatewayURL+"/healthz")&&await discoverLocalMcp())return;
  if(gateway.exitCode!==null)break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error("Private MCP listener did not become healthy.");
}
async function stopInternal(){
 const oldClient=client;client=null;
 await terminate(oldClient);
 const oldGateway=gateway;gateway=null;
 await terminate(oldGateway);
 if(workDir){try{rmSync(workDir,{recursive:true,force:true});}catch{}workDir=null;}
 startedAt=null;
}
export function stopOpenAiTunnel(){return enqueue(async()=>{
 await stopInternal();lastError=null;return {state:"disabled"};
});}
export function startOpenAiTunnel({tunnelId,apiKey}){
 return enqueue(async()=>{
  if(!validOpenAiTunnelId(tunnelId))throw Error("Invalid OpenAI tunnel ID.");
  if(!validOpenAiRuntimeKey(apiKey))throw Error("Invalid OpenAI runtime API key.");
  await stopInternal();
  lastError=null;
  try{
   await ensureGateway();
   workDir=mkdtempSync(join(tmpdir(),"maincreate-openai-"));
   chmodSync(workDir,0o700);
   const keyPath=join(workDir,"runtime-key"),headerPath=join(workDir,"mcp-auth-header");
   writeFileSync(keyPath,apiKey,{mode:0o600,flag:"wx"});
   writeFileSync(headerPath,mcpToken,{mode:0o600,flag:"wx"});
   client=spawn(clientPath,[
    "run","--control-plane.tunnel-id="+tunnelId,
    "--control-plane.api-key=file:"+keyPath,
    "--mcp.server-url="+gatewayURL+"/mcp",
    "--mcp.extra-headers=X-MainCreate-Private-Token: file:"+headerPath,
    "--mcp.discovery-extra-headers=X-MainCreate-Private-Token: file:"+headerPath,
    "--health.listen-addr=127.0.0.1:"+healthPort,
    "--log.level=warn","--log.format=json"
   ],{
    cwd:appRoot,shell:false,
    // Never pass OpenAI API key in process environment, arguments or logs.
    env:{PATH:process.env.PATH||"/usr/bin:/bin",HOME:process.env.HOME||"/tmp"},
    stdio:["ignore","ignore","ignore"]
   });
   client.on("error",()=>{lastError="Tunnel client could not start. Check deployment package.";});
   client.on("exit",(code,signal)=>{
    if(code!==0&&signal!=="SIGTERM"&&signal!=="SIGKILL")
     lastError="OpenAI tunnel client exited. Check tunnel ID, key and network.";
   });
   startedAt=new Date().toISOString();
   return {state:"starting"};
  }catch{
   await stopInternal();
   lastError="Could not start the private MCP tunnel. Check local health and package.";
   return {state:"error"};
  }
 });
}
export async function openAiRuntimeStatus(){
 const mcpReady=alive(gateway)&&await probe(gatewayURL+"/healthz")&&await discoverLocalMcp();
 const health=alive(client)&&await probe(healthURL+"/healthz");
 const ready=health&&await probe(healthURL+"/readyz");
 return {
  state:ready&&mcpReady?"ready":lastError?"error":alive(client)?"connecting":"stopped",
  mcpReady,clientHealthy:health,ready:!!ready&&mcpReady,
  startedAt,clientVersion:tunnelClientVersion,
  error:lastError||null,
  // No public URLs or secrets are returned from this endpoint.
 };
}
export async function shutdownOpenAiRuntime(){
 await stopOpenAiTunnel();
}
