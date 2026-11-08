import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const dir=mkdtempSync(join(tmpdir(),"tt-project-inventory-"));
process.env.MAIN_DATA_DIR=dir;
const {syncProjects,listProjects}=await import("./projects.mjs");
test.after(()=>rmSync(dir,{recursive:true,force:true}));

test("GitHub App installation project sync reads metadata only and joins matching build jobs",async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,opts)=>{
   assert.match(url,/api.github.com\/user\/installations\/123\/repositories/);
   assert.match(opts.headers.authorization,/^Bearer /);
   return new Response(JSON.stringify({repositories:[
    {id:11,full_name:"example-org/example-project",html_url:"https://github.com/example-org/example-project",
     default_branch:"main",pushed_at:"2026-11-07T17:00:00Z",archived:false,private:false},
    {id:12,full_name:"OtherOrg/unrelated",html_url:"https://github.com/OtherOrg/unrelated"}
   ]}),{status:200});
  };
  const updated=await syncProjects({organization:"example-org",installationId:123,accessToken:"some-long-test-token-without-privileges"});
  assert.equal(updated.repositories.length,1);
  const builds=[{source:{repository:"example-org/example-project",revision:"a".repeat(40)},status:"completed",
   created_at:"2026-11-07T17:30:00Z"}];
  const view=listProjects("example-org",builds);
  assert.equal(view.repositories.length,1);
  assert.equal(view.repositories[0].builds,1);
  assert.equal(view.repositories[0].latestBuild.status,"completed");
  assert.equal(listProjects("AnotherOrg").repositories.length,0);
 }finally{globalThis.fetch=original;}
});
test("sync failure does not erase existing repository inventory",async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({message:"Forbidden"}),{status:403});
  await assert.rejects(syncProjects({organization:"example-org",installationId:123,
   accessToken:"test-token-long-enough-for-this-case"}),/GitHub repository inventory failed/);
  assert.equal(listProjects("example-org").repositories.length,1);
 }finally{globalThis.fetch=original;}
});
