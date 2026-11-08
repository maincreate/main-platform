import {test} from "node:test";
import assert from "node:assert/strict";
import {firmwareWorkflowPreview,provisionRunnerLabel,labelForGithubRunnerId} from "./github_workflow_routing.mjs";
const projects=[{fullName:"MainCreate/WaymarkerOS",private:true,archived:false},
 {fullName:"MainCreate/public-project",private:false,archived:false}];
const builder={id:"pi",name:"pi-builder",os:"linux",arch:"arm64",
 managedHost:{id:"host"},githubRunnerName:"pi-builder"};
const route={organization:"MainCreate",repository:"MainCreate/WaymarkerOS",buildBuilderId:"pi",
 buildTrigger:"github-actions",sdk:{family:"esp-idf",version:"5.5.6"}};
const ctx=(patch={})=>({organization:"MainCreate",project:projects[0],builder,route:{...route,...patch}});
test("Unique GitHub label includes exact numeric org runner ID",()=>{
 assert.equal(labelForGithubRunnerId(1234),"maincreate-host-1234");
 for(const x of [-1,0,1.5,"1234"])assert.throws(()=>labelForGithubRunnerId(x));
});
test("A private build-only route is NOT ready until a verified unique runner label exists",()=>{
 const preview=firmwareWorkflowPreview(ctx());
 assert.equal(preview.ready,false);
 assert.equal(preview.workflow,null);
 assert.equal(preview.needsLabelProvisioning,true);
});
test("Generated GitHub Actions workflow is pinned, triggers IDE commits and cannot flash",()=>{
 const preview=firmwareWorkflowPreview(ctx({githubRunnerId:1234,
  githubRunnerName:"pi-builder",githubRunnerLabel:"maincreate-host-1234"}));
 assert.equal(preview.ready,true);
 assert.equal(preview.filePath,".github/workflows/maincreate-firmware.yml");
 assert.match(preview.workflow,/runs-on: \[self-hosted, maincreate-host-1234\]/);
 assert.match(preview.workflow,/push:\n    branches: \[main\]/);
 assert.match(preview.workflow,/workflow_dispatch:/);
 assert.match(preview.workflow,/v5\.5\.6/);
 assert.match(preview.workflow,/idf\.py build/);
 assert.match(preview.workflow,/upload-artifact@v6/);
 assert.match(preview.workflow,/maincreate-sha256\.txt/);
 assert.match(preview.workflow,/maincreate-build-\$\{\{ github.repository \}\}/);
 assert.match(preview.workflow,/\$\{IDF_PATH:\?Set IDF_PATH/);
 assert.ok(preview.workflow.includes(String.raw`find build -type f \( -name '*.bin'`));
 assert.match(preview.workflow,/sha256sum > build\/maincreate-sha256\.txt/);
 assert.ok(!['esptool','flash_idf','idf.py flash','/dev/tty'].some(term=>preview.workflow.includes(term)));
});
test("Reject public repo, cross-org routes, unsupported SDK and runner",()=>{
 for(const badCtx of [
  {...ctx(),project:projects[1],route:{...route,repository:"MainCreate/public-project"}},
  {...ctx(),organization:"OtherOrg"},
  ctx({sdk:{family:"esp-idf",version:"6.1"}}),
  ctx({buildTrigger:"manual"}),
  {...ctx(),builder:{...builder,managedHost:null}},
  {...ctx(),builder:{...builder,githubRunnerName:""}},
  {...ctx(),builder:{...builder,os:"macos",arch:"arm64"}}
 ])assert.throws(()=>firmwareWorkflowPreview(badCtx));
});
test("GitHub label provisioning makes only one scoped POST after runner identity verification",async()=>{
 const urls=[],methods=[],label="maincreate-host-128";
 const fakeFetch=async(url,opts)=>{
  urls.push(url);methods.push(opts.method||"GET");
  if(opts.method==="POST"){
   assert.equal(opts.headers.authorization,"Bearer test-github-oauth-token-long-enough");
   assert.deepEqual(JSON.parse(opts.body),{labels:[label]});
   return new Response(JSON.stringify({labels:[{name:label}]}),{status:200});
  }
  return new Response(JSON.stringify({runners:[{id:128,name:"pi-builder",status:"online"}]}),{status:200});
 };
 const result=await provisionRunnerLabel({...ctx(),token:"test-github-oauth-token-long-enough",fetchImpl:fakeFetch});
 assert.equal(result.label,label);
 assert.equal(methods.join(","),"GET,POST");
 assert.match(urls[0],/orgs\/MainCreate\/actions\/runners\?per_page=100/);
 assert.equal(urls[1],"https://api.github.com/orgs/MainCreate/actions/runners/128/labels");
});
test("GitHub label provision refuses missing/offline runner and malicious same-name mismatch",async()=>{
 for(const runners of [
  [],[{id:1,name:"pi-builder",status:"offline"}],
  [{id:1,name:"different-builder",status:"online"}]
 ]){
  const fakeFetch=async()=>new Response(JSON.stringify({runners}),{status:200});
  await assert.rejects(()=>provisionRunnerLabel({...ctx(),token:"test-github-oauth-token-long-enough",fetchImpl:fakeFetch}));
 }
});
