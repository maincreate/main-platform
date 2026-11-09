import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {validOpenAiTunnelId,validOpenAiRuntimeKey} from "./openai_tunnel_runtime.mjs";

const root=resolve(import.meta.dirname,"..");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function availablePort(){
 return new Promise((done,fail)=>{
  const sock=createServer();sock.once("error",fail);
  sock.listen(0,"127.0.0.1",()=>{const port=sock.address().port;sock.close(()=>done(port));});
 });
}
async function waitForHealth(url){
 for(let i=0;i<80;i++){
  try{const r=await fetch(url+"/healthz");if(r.ok)return;}catch{}
  await sleep(100);
 }
 throw Error("Portal did not become healthy");
}
async function post(url,path,body,headers={}){
 const r=await fetch(url+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
 return {status:r.status,result:await r.json().catch(()=>({})),headers:r.headers};
}
test("OpenAI ID and key validation prevents command injection",()=>{
 assert.equal(validOpenAiTunnelId("tunnel_"+"a".repeat(32)),true);
 assert.equal(validOpenAiTunnelId("tunnel_ab12_"+"7".repeat(32)),true);
 for(const id of ["tunnel_invalid","tunnel_"+"A".repeat(32),"tunnel_"+ "a".repeat(32)+"; touch /tmp/x"]){
  assert.equal(validOpenAiTunnelId(id),false);
 }
 assert.equal(validOpenAiRuntimeKey("sk-"+"a".repeat(36)),true);
 for(const k of ["bad","sk-short","sk-"+"a".repeat(25)+"\nMORE"])assert.equal(validOpenAiRuntimeKey(k),false);
});
test("Settings config and lifecycle require admin+CSRF and never disclose secrets",{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),"maincreate-ai-settings-"));
 const port=await availablePort(),base="http://127.0.0.1:"+port;
 const child=spawn(process.execPath,["portal/server.mjs"],{
  cwd:root,env:{...process.env,HOST:"127.0.0.1",PORT:String(port),
   MAIN_DATA_DIR:dir,MAIN_MASTER_KEY:"",MAIN_REQUIRE_LOGIN:"1",
   MAIN_ENABLE_FABRIC_EXECUTION:"0"},
  stdio:"ignore"
 });
 try{
  await waitForHealth(base);
  const entry="/api/local/ai/openai";
  assert.equal((await fetch(base+entry)).status,401);
  assert.equal((await post(base,entry+"/configure",{tunnelId:"x",apiKey:"sk-"+"x".repeat(40)})).status,401);
  const password="test-unshared-local-password-1234";
  const bootstrap=await post(base,"/api/local/bootstrap",{username:"admin",password});
  assert.equal(bootstrap.status,200);
  const cookie=bootstrap.headers.get("set-cookie").split(";")[0];
  const csrf=bootstrap.result.csrf;
  const authed={cookie,"x-maincreate-csrf":csrf};
  assert.equal((await post(base,entry+"/configure",{tunnelId:"x"},{cookie})).status,403);
  assert.equal((await post(base,entry+"/configure",{tunnelId:"x",apiKey:"sk-"+"x".repeat(40)},authed)).status,422);
  assert.equal((await post(base,entry+"/configure",{tunnelId:"tunnel_"+"a".repeat(32),apiKey:"sk-no"},authed)).status,422);
  const tunnelId="tunnel_"+"a".repeat(32),apiKey="sk-"+"private-example-key-".repeat(3);
  const configured=await post(base,entry+"/configure",{tunnelId,apiKey},authed);
  assert.equal(configured.status,200,JSON.stringify(configured.result));
  assert.equal(configured.result.configured,true);
  assert.equal(configured.result.keySaved,true);
  assert.equal(configured.result.enabled,true);
  assert.equal(configured.result.tunnelId,tunnelId);
  assert(!JSON.stringify(configured.result).includes(apiKey));
  // Local MCP is loopback-only and requires a separate random internal token;
  // a browser/ChatGPT Authorization header cannot substitute for it.
  const gatewayHealth=await fetch("http://127.0.0.1:18191/healthz");
  assert.equal(gatewayHealth.status,200);
  const healthState=await gatewayHealth.json();
  assert.equal(healthState.authConfigured,true);
  const unauthenticatedMcp=await fetch("http://127.0.0.1:18191/mcp",{
   method:"POST",headers:{"content-type":"application/json",
    accept:"application/json, text/event-stream",
    authorization:"Bearer "+"q".repeat(64)},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}})
  });
  assert.equal(unauthenticatedMcp.status,401);
  const stored=readFileSync(join(dir,"state.json"),"utf8");
  assert(!stored.includes(apiKey),"Never write plaintext OpenAI keys to controller state");
  assert.match(stored,/"runtimeKey":\s*\{[^}]*"iv"/);
  const read=await (await fetch(base+entry,{headers:{cookie}})).json();
  assert.equal(read.configured,true);
  assert.equal(read.chatgptPluginConnected,null,"Do not claim ChatGPT has registered its custom app");
  assert(!JSON.stringify(read).includes(apiKey));
  const disabled=await post(base,entry+"/disable",{},authed);
  assert.equal(disabled.status,200);
  assert.equal(disabled.result.enabled,false);
  assert.equal(disabled.result.keySaved,true);
  // Previously encrypted key can be reused without entering it again.
  const resumed=await post(base,entry+"/configure",{tunnelId},authed);
  assert.equal(resumed.status,200);
  assert.equal(resumed.result.enabled,true);
  const forgotten=await post(base,entry+"/remove",{},authed);
  assert.equal(forgotten.status,200);
  assert.equal(forgotten.result.configured,false);
  assert.equal(forgotten.result.keySaved,false);
  assert(!readFileSync(join(dir,"state.json"),"utf8").includes(apiKey));
 }finally{
  child.kill("SIGTERM");
  await sleep(300);
  if(child.exitCode===null)child.kill("SIGKILL");
  rmSync(dir,{recursive:true,force:true});
 }
});
