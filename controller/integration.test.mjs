import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from "node:fs";
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
 const portal=spawn(process.execPath,["portal/server.mjs"],{cwd:root,env:{...process.env,HOST:"127.0.0.1",PORT:String(p),TT_DATA_DIR:dir,TT_GITHUB_CLIENT_ID:"",TT_MASTER_KEY:"",TT_SERVICE_TOKEN:service,TT_MCP_TOKEN:mcpToken,TT_REQUIRE_LOGIN:"1",TT_ENABLE_FABRIC_EXECUTION:"0"},stdio:"ignore"});
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
   assert.equal(authedRoot.status,302);
   assert.equal(authedRoot.headers.get("location"),"/github");
   const setupAfterAccount=await fetch(base+"/setup",{headers:{cookie},redirect:"manual"});
   assert.equal(setupAfterAccount.status,302);
   assert.equal(setupAfterAccount.headers.get("location"),"/github");

   const topologyPublic=await fetch(base+"/topology",{redirect:"manual"});
   assert.equal(topologyPublic.status,302);
   assert.equal(topologyPublic.headers.get("location"),"/setup");
   const topologyPrivate=await fetch(base+"/topology",{headers:{cookie}});
   assert.equal(topologyPrivate.status,200);
   const topologyHtml=await topologyPrivate.text();
   for(const section of ["Cloud services","Secure access","MCP gateway","Workspace","Build machines","Toolkits"]){
     assert(topologyHtml.includes(section),"Topology missing "+section);
   }
   assert.match(topologyHtml,/id="topologyRunners"/);
   assert.match(topologyHtml,/id="topologyDevices"/);
   assert.match(topologyHtml,/id="topoGithubMeta"/);
   assert.match(topologyHtml,/id="topologyMap"/);
   assert.equal((await fetch(base+"/topology.js")).status,401);
   for(const page of ["settings","devices","projects"]){
     assert.equal((await fetch(base+"/"+page,{redirect:"manual"})).status,302);
     assert.equal((await fetch(base+"/"+page,{headers:{cookie}})).status,200);
     assert.equal((await fetch(base+"/"+page+".js")).status,401);
     assert.equal((await fetch(base+"/"+page+".js",{headers:{cookie}})).status,200);
   }
   assert.equal((await fetch(base+"/workspace.css")).status,401);
   assert.equal((await fetch(base+"/workspace.css",{headers:{cookie}})).status,200);
   assert.equal((await fetch(base+"/api/local/devices")).status,401);


   assert.equal((await fetch(base+"/api/local/projects")).status,401);

   assert.equal((await fetch(base+"/jobs",{redirect:"manual"})).status,302);
   assert.equal((await fetch(base+"/jobs",{headers:{cookie}})).status,200);
   assert.equal((await fetch(base+"/jobs.js")).status,401);
   assert.equal((await fetch(base+"/jobs.css")).status,401);
   assert.equal((await fetch(base+"/jobs.js",{headers:{cookie}})).status,200);
   assert.equal((await fetch(base+"/api/local/fabric",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})).status,401);
   const topoScript=await fetch(base+"/topology.js",{headers:{cookie}});
   assert.equal(topoScript.status,200);
   assert.match(await topoScript.text(),/renderTopology/);
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
   assert.deepEqual(overview.runners.items,[]);
   assert.equal(overview.runners.executionEnabled,false);
   assert.equal(overview.topology.toolkitsDiscovered,false);
   assert.equal(overview.topology.secureConnectionVerified,false);
   const ghResponse=await fetch(base+"/api/local/github/device/status",{headers:{cookie}});
   const ghStatus=await ghResponse.json();
   assert.equal(ghResponse.status,200,"GitHub device status: "+JSON.stringify(ghStatus));
   assert.equal(ghStatus.available,true);
   assert.equal(ghStatus.clientId,"Iv23liAxFGcez9en0tY8");
   assert.equal(ghStatus.usingDefaultApp,true);
   assert.equal(ghStatus.connected,false);
   const ghHeaders={cookie,"x-tt-csrf":csrf};
   // Repository creation defaults to private; changes are authenticated and CSRF-protected.
   const prefPath="/api/local/github/repository/preferences";
   assert.equal((await json(base,prefPath,{defaultVisibility:"public"})).status,401);
   assert.equal((await json(base,prefPath,{defaultVisibility:"public"},{cookie})).status,403);
   assert.equal((await json(base,prefPath,{defaultVisibility:"internal"},ghHeaders)).status,422);
   assert.equal((await json(base,prefPath,{defaultVisibility:"public"},ghHeaders)).status,200);
   const preference=await (await fetch(base+prefPath,{headers:{cookie}})).json();
   assert.equal(preference.defaultVisibility,"public");
   const noOrganization=await json(base,"/api/local/github/repository/create",{name:"firmware" },ghHeaders);
   assert.equal(noOrganization.status,409);
   const unauthenticatedMcp=await json(base,"/api/internal/github/repository/request",{name:"firmware"});
   assert([401,503].includes(unauthenticatedMcp.status));
   const sampleClientId="sample-public-github-app-id";
   assert.equal((await json(base,"/api/local/github/device/config",{clientId:sampleClientId})).status,401);
   assert.equal((await json(base,"/api/local/github/device/config",{clientId:sampleClientId},{cookie})).status,403);
   assert.equal((await json(base,"/api/local/github/device/config",{clientId:"bad"},ghHeaders)).status,422);
   assert.equal((await json(base,"/api/local/github/device/config",{clientId:sampleClientId},ghHeaders)).status,200);
   const ghConfigured=await (await fetch(base+"/api/local/github/device/status",{headers:{cookie}})).json();
   assert.equal(ghConfigured.available,true);
   assert.equal(ghConfigured.clientId,sampleClientId);
   assert.equal(ghConfigured.configuredByEnvironment,false);
   assert.equal((await json(base,"/api/local/github/device/installations/refresh",{},ghHeaders)).status,409);

   // Starting a real device authorization requires GitHub network access and is covered by a separate live test.
   // Integration tests never perform a remote authorization or leak a device code.
   assert.equal((await json(base,"/api/local/github/device/poll",{},{"cookie":cookie,"x-tt-csrf":csrf})).status,409);
   assert.equal((await json(base,"/api/local/github/device/organization",{organization:"Example",standardHostedRunnersDisabledConfirmed:true},{"cookie":cookie,"x-tt-csrf":csrf})).status,409);
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
   assert.equal(hb.data.ok,true);
   // End-to-end fabric API: authenticated planning, explicit approval and default no-execution.
   const fabricHeaders={cookie,"x-tt-csrf":csrf};
   const fabricCall=async(tool,args={})=>json(base,"/api/local/fabric",{tool,arguments:args},fabricHeaders);
   const discovered=await fabricCall("tt_discover",{resource:"capabilities"});
   assert.equal(discovered.status,200);
   assert(discovered.data.capabilities.some(x=>x.id==="host.snapshot"));
   assert(discovered.data.capabilities.some(x=>x.id==="firmware.esp_idf.flash"&&x.state==="unavailable"));
   const planned=await fabricCall("tt_plan",{capability:"host.snapshot",runner_id:enrolled.data.id,parameters:{}});
   assert.equal(planned.status,200);
   assert.equal(planned.data.requires_approval,true);
   const jobRequest=await fabricCall("tt_execute",{plan_id:planned.data.plan_id});
   assert.equal(jobRequest.status,200);
   assert.equal(jobRequest.data.job.status,"awaiting_approval");
   const noClaim=await json(base,"/api/agent/jobs/claim",{id:enrolled.data.id},
     {authorization:"Bearer "+enrolled.data.token});
   assert.equal(noClaim.data.job,null);
   assert.equal(noClaim.data.executionEnabled,false);
   assert.equal((await json(base,"/api/local/jobs/approval",{job_id:jobRequest.data.job.id,decision:"approve"}, {cookie})).status,403);
   const approved=await json(base,"/api/local/jobs/approval",{job_id:jobRequest.data.job.id,decision:"approve"},fabricHeaders);
   assert.equal(approved.status,200);
   assert.equal(approved.data.job.status,"queued");
   const stillNoClaim=await json(base,"/api/agent/jobs/claim",{id:enrolled.data.id},
     {authorization:"Bearer "+enrolled.data.token});
   assert.equal(stillNoClaim.data.job,null);
   const cancelled=await fabricCall("tt_jobs",{action:"cancel",job_id:jobRequest.data.job.id});
   assert.equal(cancelled.status,200);
   assert.equal(cancelled.data.job.status,"cancelled");
   assert.equal((await json(base,"/api/internal/fabric",{tool:"tt_discover",arguments:{resource:"capabilities"}})).status,401);

   const topoOverview=await (await fetch(base+"/api/local/overview",{headers:{cookie}})).json();
   assert.equal(topoOverview.runners.count,1);
   assert.equal(topoOverview.runners.items[0].name,"build-pi");
   assert.equal(topoOverview.runners.items[0].os,"linux");
   assert.equal(topoOverview.runners.items[0].arch,"arm64");
   assert.equal(typeof topoOverview.runners.items[0].lastSeen,"string");
   assert(!("token" in topoOverview.runners.items[0]));
   assert(!("tokenHash" in topoOverview.runners.items[0]));
   const cfg=await (await fetch(base+"/api/local/config",{headers:{cookie}})).json();
   assert.equal(cfg.config.name,"Home Lab");
   assert.equal(cfg.runners.length,1);
   assert.equal(cfg.github.hasPrivateKey,true);
   // The dashboard and topology share one authenticated overview contract:
   // a selected organization is connected only while an OAuth credential is usable.
   const statePath=join(dir,"state.json"),originalState=readFileSync(statePath,"utf8");
   const account=JSON.parse(originalState);
   account.github.oauthUser={login:"example-user",id:12};
   account.github.oauthToken={iv:"fixture",ct:"fixture",tag:"fixture"};
   account.github.selectedOrganization="ExampleOrg";
   account.github.oauthExpiresAt=new Date(Date.now()+3600_000).toISOString();
   writeFileSync(statePath,JSON.stringify(account,null,2),{mode:0o600});
   const linked=await (await fetch(base+"/api/local/overview",{headers:{cookie}})).json();
   assert.equal(linked.github.identityConnected,true);
   assert.equal(linked.github.organization,"ExampleOrg");
   // Once GitHub OAuth and an installed organization are selected, entry is permitted.
   account.github.oauthOrganizations=[{login:"ExampleOrg"}];
   writeFileSync(statePath,JSON.stringify(account,null,2),{mode:0o600});
   // The fixture token represents a linked session; the route checks connection state without exchanging it.
   const connectedRoot=await fetch(base+"/",{headers:{cookie},redirect:"manual"});
   assert.equal(connectedRoot.status,200);
   assert.match(await connectedRoot.text(),/id="recentJobs"/);
   assert.equal(linked.github.login,"example-user");
   assert.equal(linked.github.authorizationExpired,false);
   account.github.oauthExpiresAt=new Date(Date.now()-3600_000).toISOString();
   writeFileSync(statePath,JSON.stringify(account,null,2),{mode:0o600});
   const expired=await (await fetch(base+"/api/local/overview",{headers:{cookie}})).json();
   assert.equal(expired.github.identityConnected,false);
   assert.equal(expired.github.authorizationExpired,true);
   assert.equal(expired.github.organization,null);
   assert.equal(expired.github.savedOrganization,"ExampleOrg");
   delete account.github.oauthToken;
   account.github.oauthExpiresAt=new Date(Date.now()+3600_000).toISOString();
   writeFileSync(statePath,JSON.stringify(account,null,2),{mode:0o600});
   const withoutToken=await (await fetch(base+"/api/local/overview",{headers:{cookie}})).json();
   assert.equal(withoutToken.github.identityConnected,false);
   assert.equal(withoutToken.github.authorizationExpired,true);
   writeFileSync(statePath,originalState,{mode:0o600});

   assert(!("token" in cfg.runners[0]));
   gateway=spawn(process.execPath,["gateway/server.mjs"],{cwd:root,env:{...process.env,HOST:"127.0.0.1",PORT:String(g),TT_CONTROLLER_URL:base,TT_MCP_TOKEN:mcpToken,TT_SERVICE_TOKEN:service},stdio:"ignore"});
   await ready(mcp);
   const headersMcp={"content-type":"application/json",accept:"application/json, text/event-stream"};
   assert.equal((await json(mcp,"/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"},headersMcp)).status,401);
   const authorized={...headersMcp,authorization:"Bearer "+mcpToken};
   const init=await json(mcp,"/mcp",{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25"}},authorized);
   assert.equal(init.status,200);
   assert.equal(init.data.result.serverInfo.name,"tinkertunnel");
   const list=await json(mcp,"/mcp",{jsonrpc:"2.0",id:2,method:"tools/list"},authorized);
   assert.deepEqual(list.data.result.tools.map(t=>t.name),["tt_discover","tt_inspect","tt_plan","tt_execute","tt_jobs","tt_github_repository_request","tt_assets"]);
   const runners=await json(mcp,"/mcp",{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"tinkertunnel_list_runners",arguments:{}}},authorized);
   assert.equal(runners.data.result.isError,false);
   assert.match(runners.data.result.content[0].text,/build-pi/);
   const discovery=await json(mcp,"/mcp",{jsonrpc:"2.0",id:5,method:"tools/call",
     params:{name:"tt_discover",arguments:{resource:"capabilities"}}},authorized);
   assert.equal(discovery.data.result.isError,false);
   assert(discovery.data.result.structuredContent.capabilities.some(x=>x.id==="host.snapshot"));
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
   const resetLogin=await json(base,"/api/local/login",{username:adminUsername,password:"new-long-credential-987654"});
   assert.equal(resetLogin.status,200);
   const resetHeaders={cookie:resetLogin.headers.get("set-cookie").split(";")[0],"x-tt-csrf":resetLogin.data.csrf};
   const prefs=await (await fetch(base+"/api/local/approval-settings",{headers:{cookie:resetHeaders.cookie}})).json();
   assert.equal(prefs.buildApproval,"review");assert.equal(prefs.flashApproval,"always");
   assert.equal((await json(base,"/api/local/approval-settings",{buildApproval:"automatic",flashApproval:"automatic"},resetHeaders)).status,422);
   assert.equal((await json(base,"/api/local/approval-settings",{buildApproval:"automatic",flashApproval:"always"},resetHeaders)).status,200);
   const storedPrefs=await (await fetch(base+"/api/local/approval-settings",{headers:{cookie:resetHeaders.cookie}})).json();
   assert.equal(storedPrefs.buildApproval,"automatic");
   assert.equal((await json(base,"/api/local/installation/reset",{password:"wrong",confirm:"RESET TINKERTUNNEL"},resetHeaders)).status,401);
   assert.equal((await json(base,"/api/local/installation/reset",{password:"new-long-credential-987654",confirm:"incorrect"},resetHeaders)).status,422);
   const reset=await json(base,"/api/local/installation/reset",{password:"new-long-credential-987654",confirm:"RESET TINKERTUNNEL"},resetHeaders);
   assert.equal(reset.status,200);assert.equal(reset.data.reset,true);
   assert.match(reset.data.backup,/^reset-backups\/reset-/);
   assert.equal(statSync(join(dir,reset.data.backup,"state.json")).isFile(),true);
   assert.equal((await (await fetch(base+"/api/local/public")).json()).claimed,false);
   assert.equal((await fetch(base+"/api/local/overview",{headers:{cookie:resetHeaders.cookie}})).status,401);
   assert.equal((await json(base,"/api/local/bootstrap",{username:"fresh-admin",password:"fresh-password-after-reset-123"})).status,200);

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
