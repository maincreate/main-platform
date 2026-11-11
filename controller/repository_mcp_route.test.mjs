import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes,createCipheriv} from "node:crypto";

test("Authenticated MCP repository creation goes straight to GitHub without a portal approval",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"maincreate-repo-mcp-"));
  const key=randomBytes(32);
  const token="a".repeat(30),serviceToken="b".repeat(64);
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
  const sealed=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  const oauthToken={iv:iv.toString("base64"),ct:sealed.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
  const state={
    schema:1,config:{name:"Main{Create}",role:"all-in-one"},
    github:{
      oauthUser:{login:"test-user",id:123},oauthToken,
      oauthExpiresAt:new Date(Date.now()+3600000).toISOString(),
      selectedOrganization:"TinkerTunnel",
      defaultVisibility:"private",
      oauthOrganizations:[{login:"TinkerTunnel",id:555,installationId:999}],
      repositoryRequests:[
        {id:"c".repeat(32),organization:"TinkerTunnel",name:"old-project",status:"pending"},
        {id:"d".repeat(32),organization:"TinkerTunnel",name:"esp32-expression",visibility:"private",status:"pending"}
      ]
    },runners:[],invites:[]
  };
  writeFileSync(join(dir,"master.key"),key);
  writeFileSync(join(dir,"state.json"),JSON.stringify(state));
  const prev={data:process.env.MAIN_DATA_DIR,service:process.env.MAIN_SERVICE_TOKEN,fetch:globalThis.fetch};
  process.env.MAIN_DATA_DIR=dir;
  process.env.MAIN_SERVICE_TOKEN=serviceToken;
  try{
    // Set env before loading the controller, which captures its local data path at import time.
    const {localRoute}=await import("./routes.mjs");
    let calls=0;
    globalThis.fetch=async(url,init)=>{
      calls++;
      assert.equal(url,"https://api.github.com/orgs/TinkerTunnel/repos");
      assert.equal(init.method,"POST");
      assert.equal(init.headers.authorization,"Bearer "+token);
      assert.deepEqual(JSON.parse(init.body),{name:"esp32-expression",description:"",private:true,auto_init:true});
      return new Response(JSON.stringify({id:5555,name:"esp32-expression",full_name:"TinkerTunnel/esp32-expression",
        private:true,owner:{login:"TinkerTunnel"},html_url:"https://github.com/TinkerTunnel/esp32-expression"}),{status:201});
    };
    function req(value,auth=serviceToken){
      return new Request("http://localhost/api/internal/github/repository/request",{
        method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+auth},
        body:JSON.stringify(value)
      });
    }
    const unauthorized=await localRoute(req({name:"esp32-expression"},"not-authorized"));
    assert.equal(unauthorized.status,401);
    assert.equal(calls,0);
    const crossOrg=await localRoute(req({name:"esp32-expression",organization:"Elsewhere"}));
    assert.equal(crossOrg.status,422);
    assert.equal(calls,0);
    const created=await localRoute(req({name:"esp32-expression"}));
    assert.equal(created.status,201);
    const payload=await created.json();
    assert.equal(payload.status,"created");
    assert.equal(payload.requires_approval,false);
    assert.equal(payload.repository.fullName,"TinkerTunnel/esp32-expression");
    assert.equal(calls,1);
    const saved=JSON.parse(readFileSync(join(dir,"state.json"),"utf8"));
    assert.equal(saved.github.repositoryAudit.at(-1).repository,"TinkerTunnel/esp32-expression");
    assert.equal(saved.github.repositoryRequests.length,2);
    assert.equal(saved.github.repositoryRequests[0].status,"pending");
    assert.equal(saved.github.repositoryRequests[1].status,"created");
    assert.equal(saved.github.repositoryRequests[1].result.fullName,"TinkerTunnel/esp32-expression");
    // No delete-repository route exists even when using the authenticated service token.
    const deletion=await localRoute(new Request("http://localhost/api/internal/github/repository/delete",{
      method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+serviceToken},
      body:JSON.stringify({name:"esp32-expression"})
    }));
    assert.equal(deletion.status,404);
  }finally{
    globalThis.fetch=prev.fetch;
    if(prev.data===undefined)delete process.env.MAIN_DATA_DIR;else process.env.MAIN_DATA_DIR=prev.data;
    if(prev.service===undefined)delete process.env.MAIN_SERVICE_TOKEN;else process.env.MAIN_SERVICE_TOKEN=prev.service;
    rmSync(dir,{recursive:true,force:true});
  }
});
