import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {randomBytes} from "node:crypto";

const root=resolve(import.meta.dirname,"..");
const token=()=>randomBytes(32).toString("hex");
async function freePort(){
 return new Promise((resolve,reject)=>{
   const srv=createServer();srv.once("error",reject);
   srv.listen(0,"127.0.0.1",()=>{const port=srv.address().port;srv.close(()=>resolve(port));});
 });
}
async function ready(base){
 for(let i=0;i<100;i++){
   try{const r=await fetch(base+"/healthz");if(r.ok)return;}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw new Error("Server failed health check: "+base);
}
async function json(base,path,data,headers={}){
 const r=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(data)});
 return {status:r.status,data:await r.json(),headers:r.headers};
}

test("controller configuration persists, secrets stay encrypted, runners enroll once, MCP reads only",{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),"tt-controller-"));
 const p=await freePort(),g=await freePort();
 const base="http://127.0.0.1:"+p, mcp="http://127.0.0.1:"+g;
 const adminUsername="admin",password="secure-user-created-password-123",service=token(),mcpToken=token();
 const portal=spawn(process.execPath,["portal/server.mjs"],{cwd:root,env:{...process.env,HOST:"127.0.0.1",PORT:String(p),TT_DATA_DIR:dir,TT_GITHUB_CLIENT_ID:"",TT_MASTER_KEY:"",TT_SERVICE_TOKEN:service,TT_MCP_TOKEN:mcpToken,TT_REQUIRE_LOGIN:"1"},stdio:"ignore"});
 let gateway;
 try{
   await ready(base);
   const anonymousRoot=await fetch(base+"/",{redirect:"manual"});
   assert.equal(anonymousRoot.status,302);
   assert.equal(anonymousRoot.headers.get("location"),"/setup");
   const setupHtml=await (await fetch(base+"/setup")).text();
   assert.match(setupHtml,/Create your administrator account/);
   assert.doesNotMatch(setupHtml,/Coolify|deployment role|MCP server|private key/i,"Initial setup must contain account creation only");
   assert.equal((await fetch(base+"/setup.css")).status,200);
   assert.equal((await fetch(base+"/setup.js")).status,200);
   assert.equal((await fetch(base+"/api/local/config")).status,401);
   const publicInfo=await (await fetch(base+"/api/local/public")).json();
   assert.equal(publicInfo.claimed,false);
   assert.equal((await json(base,"/api/local/login",{username:adminUsername,password})).status,409);
   assert.equal((await json(base,"/api/local/bootstrap",{username:adminUsername,password:"short"})).status,422);
   const bootstrap=await json(base,"/api/local/bootstrap",{username:adminUsername,password});
   assert.equal(bootstrap.status,200);
   assert.equal(bootstrap.data.username,adminUsername);
   assert.equal((await json(base,"/api/local/bootstrap",{username:"attacker",password})).status,409);
   assert.equal((await (await fetch(base+"/api/local/public")).json()).claimed,true);
   assert.equal((await json(base,"/api/local/login",{username:adminUsername,password:"invalid"})).status,401);
   const login=await json(base,"/api/local/login",{username:adminUsername,password});
   assert.equal(login.status,200);
   const cookie=login.headers.get("set-cookie").split(";")[0],csrf=login.data.csrf;
   const authedRoot=await fetch(base+"/",{headers:{cookie},redirect:"manual"});
   assert.equal(authedRoot.status,200);
   const dashboard=await authedRoot.text();
   assert.match(dashboard,/TinkerTunnel • Dashboard/);
   assert.match(dashboard,/Get connected/);
   assert.equal((await fetch(base+"/setup",{headers:{cookie},redirect:"manual"})).status,302);
   assert.equal((await fetch(base+"/dashboard.css")).status,401);
   assert.equal((await fetch(base+"/dashboard.js",{headers:{cookie}})).status,200);
   assert.equal((await fetch(base+"/github",{redirect:"manual"})).status,302);
   assert.equal((await fetch(base+"/github",{headers:{cookie}})).status,200);
   assert.equal((await fetch(base+"/github.js",{headers:{cookie}})).status,200);
   assert.equal((await fetch(base+"/api/local/overview")).status,401);
   const overview=await (await fetch(base+"/api/local/overview",{headers:{cookie}})).json();
   assert.equal(overview.username,adminUsername);
   assert.equal(overview.workspace.name,"TinkerTunnel");
   assert.equal(overview.github.identityConnected,false);
   assert.equal(overview.runners.count,0);
   const ghStatus=await (await fetch(base+"/api/local/github/device/status",{headers:{cookie}})).json();
   assert.equal(ghStatus.available,false);
   assert.equal(ghStatus.connected,false);
   assert.equal((await json(base,"/api/local/github/device/start",{},{"cookie":cookie,"x-tt-csrf":csrf})).status,503);
   const httpsLogin=await json(base,"/api/local/login",{username:adminUsername,password},{"x-forwarded-proto":"https"});
   assert.equal(httpsLogin.status,200);
   assert.match(httpsLogin.headers.get("set-cookie")||"",/; Secure$/);
   assert.equal(statSync(join(dir,"master.key")).size,32);
   if(process.platform!=="win32")assert.equal(statSync(join(dir,"master.key")).mode & 0o777,0o600);
   const headers={cookie,"x-tt-csrf":csrf};
   const newState={name:"Home Lab",role:"all-in-one",tunnelHostname:"mcp.example.com"};
   assert.equal((await json(base,"/api/local/config",newState,{cookie})).status,403);
   assert.equal((await json(base,"/api/local/config",newState,headers)).status,200);
   const pem="-----BEGIN PRIVATE KEY-----\nsensitive-test-value\n-----END PRIVATE KEY-----";
   assert.equal((await json(base,"/api/local/github",{appId:123,installationId:456,repository:"Example/app",privateKey:pem},headers)).status,200);
   const state=readFileSync(join(dir,"state.json"),"utf8");
   assert(!state.includes(pem));
   assert(!state.includes(password),"Password must never be persisted as plaintext");
   assert(state.includes('"algorithm": "scrypt"'),"Persistent password hash uses scrypt");
   assert(state.includes('"iv"')&&state.includes('"ct"')&&state.includes('"tag"'));
   if(process.platform!=="win32")assert.equal(statSync(join(dir,"state.json")).mode & 0o777,0o600);
   const invite=await json(base,"/api/local/runners/invite",{},headers);
   assert.equal(invite.status,200);
   const request={token:invite.data.token,name:"build-pi",os:"linux",arch:"arm64"};
   const enrolled=await json(base,"/api/agent/enroll",request);
   assert.equal(enrolled.status,200);
   assert.equal((await json(base,"/api/agent/enroll",request)).status,401);
   assert(!readFileSync(join(dir,"state.json"),"utf8").includes(enrolled.data.token));
   const hb=await json(base,"/api/agent/heartbeat",{id:enrolled.data.id},{authorization:"Bearer "+enrolled.data.token});
   assert.equal(hb.status,200);
   assert.equal(hb.data.jobExecution,"disabled");
   const cfg=await (await fetch(base+"/api/local/config",{headers:{cookie}})).json();
   assert.equal(cfg.config.name,"Home Lab");
   assert.equal(cfg.runners.length,1);
   assert.equal(cfg.github.hasPrivateKey,true);
   assert(!("token" in cfg.runners[0]));
   gateway=spawn(process.execPath,["gateway/server.mjs"],{cwd:root,env:{...process.env,HOST:"127.0.0.1",PORT:String(g),TT_CONTROLLER_URL:base,TT_MCP_TOKEN:mcpToken,TT_SERVICE_TOKEN:service},stdio:"ignore"});
   await ready(mcp);
   const headersMcp={"content-type":"application/json",accept:"application/json, text/event-stream"};
   assert.equal((await json(mcp,"/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"},headersMcp)).status,401);
   const authorized={...headersMcp,authorization:"Bearer "+mcpToken};
   const init=await json(mcp,"/mcp",{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25"}},authorized);
   assert.equal(init.status,200);
   assert.equal(init.data.result.serverInfo.name,"tinkertunnel-local");
   const list=await json(mcp,"/mcp",{jsonrpc:"2.0",id:2,method:"tools/list"},authorized);
   assert.deepEqual(list.data.result.tools.map(t=>t.name),["tinkertunnel_status","tinkertunnel_list_runners","tinkertunnel_framework_catalog","tinkertunnel_plan_install"]);
   const runners=await json(mcp,"/mcp",{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"tinkertunnel_list_runners",arguments:{}}},authorized);
   assert.equal(runners.data.result.isError,false);
   assert.match(runners.data.result.content[0].text,/build-pi/);
   const planner=await json(mcp,"/mcp",{jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"tinkertunnel_plan_install",arguments:{framework:"esp-idf",os:"linux",arch:"arm64"}}},authorized);
   assert.equal(planner.data.result.isError,false);
   assert.match(planner.data.result.content[0].text,/dry_run/);
   assert.equal((await fetch(base+"/mcp")).status,503);
   const logout=await json(base,"/api/local/logout",{},headers);
   assert.equal(logout.status,200);
   assert.equal((await fetch(base+"/",{headers:{cookie},redirect:"manual"})).status,302);
   // Changing credentials invalidates all prior sessions and old passwords.
   const nextLogin=await json(base,"/api/local/login",{username:adminUsername,password});
   assert.equal(nextLogin.status,200);
   const changeCookie=nextLogin.headers.get("set-cookie").split(";")[0];
   const changeHeaders={cookie:changeCookie,"x-tt-csrf":nextLogin.data.csrf};
   assert.equal((await json(base,"/api/local/account/password",{currentPassword:"wrong",newPassword:"new-long-credential-987654"},changeHeaders)).status,401);
   const changed=await json(base,"/api/local/account/password",{currentPassword:password,newPassword:"new-long-credential-987654"},changeHeaders);
   assert.equal(changed.status,200);
   assert.equal((await fetch(base+"/",{headers:{cookie:changeCookie},redirect:"manual"})).status,302);
   assert.equal((await json(base,"/api/local/login",{username:adminUsername,password})).status,401);
   assert.equal((await json(base,"/api/local/login",{username:adminUsername,password:"new-long-credential-987654"})).status,200);
 } finally {
   portal.kill("SIGTERM");gateway?.kill("SIGTERM");
   rmSync(dir,{recursive:true,force:true});
 }
});

test("first administrator persists across server restarts without a login environment secret",{timeout:30000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),"tt-auth-persist-"));
 const p=await freePort(),base="http://127.0.0.1:"+p;
 const password="persistent-account-password-2026";
 const env={...process.env,HOST:"127.0.0.1",PORT:String(p),TT_DATA_DIR:dir,TT_ADMIN_TOKEN:"",TT_MASTER_KEY:"",TT_REQUIRE_LOGIN:"1"};
 let child;
 const launch=async()=>{
   child=spawn(process.execPath,["portal/server.mjs"],{cwd:root,env,stdio:"ignore"});
   await ready(base);
 };
 try {
   await launch();
   const registered=await json(base,"/api/local/bootstrap",{username:"owner",password});
   assert.equal(registered.status,200);
   const keyBefore=readFileSync(join(dir,"master.key")).toString("hex");
   await new Promise(resolve=>{child.once("exit",resolve);child.kill("SIGTERM");});
   await launch();
   assert.equal((await (await fetch(base+"/api/local/public")).json()).claimed,true);
   assert.equal((await json(base,"/api/local/bootstrap",{username:"intruder",password})).status,409);
   assert.equal((await json(base,"/api/local/login",{username:"owner",password})).status,200);
   assert.equal(readFileSync(join(dir,"master.key")).toString("hex"),keyBefore);
 } finally {
   if(child&&!child.killed)child.kill("SIGTERM");
   rmSync(dir,{recursive:true,force:true});
 }
});
