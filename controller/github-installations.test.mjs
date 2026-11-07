import {test} from "node:test";
import assert from "node:assert/strict";
import {githubInstallations} from "./routes.mjs";

test("GitHub App installation discovery includes only accessible organizations", async ()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async (url,options)=>{
      assert.equal(String(url),"https://api.github.com/user/installations?per_page=100");
      assert.match(options.headers.authorization,/^Bearer /);
      return new Response(JSON.stringify({
        total_count:4,
        installations:[
          {id:101,account:{id:17,login:"ExampleOrg",type:"Organization"}},
          {id:102,account:{id:17,login:"ExampleOrg",type:"Organization"}},
          {id:103,account:{id:18,login:"AnotherOrg",type:"Organization"}},
          {id:104,account:{id:19,login:"PersonalUser",type:"User"}}
        ]
      }),{status:200,headers:{"content-type":"application/json"}});
    };
    const result=await githubInstallations("example-authentication-value");
    assert.deepEqual(result.organizations,[
      {login:"ExampleOrg",id:17,installationId:101},
      {login:"AnotherOrg",id:18,installationId:103}
    ]);
    assert.equal(result.installationsTotal,4);
    assert.equal(result.hasMoreInstallations,false);
  }finally{globalThis.fetch=original;}
});

test("GitHub App installation discovery rejects unauthorized responses",async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify({message:"Forbidden"}),{status:403});
    await assert.rejects(githubInstallations("example-authentication-value"),/installations/);
  }finally{globalThis.fetch=original;}
});
