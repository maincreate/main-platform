import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const dir=mkdtempSync(join(tmpdir(),"maincreate-monitor-"));
process.env.MAIN_DATA_DIR=dir;
const {parseRequirements,inferRequirementsFromWorkflows,evaluateProject,versionSatisfied,projectSummary,setProjectIgnored,detectProjectRequirements}=await import("./project_monitor.mjs");
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const manifests={
 esp:JSON.stringify({schema:1,targets:[{os:"linux",arch:"arm64",tools:[{name:"esp-idf",version:"5.5.x"}]}]}),
 ios:JSON.stringify({schema:1,targets:[{os:"macos",tools:[{name:"xcode",version:">=16.4"}]}]})
};
const online=(name,os,arch,packages)=>({name,os,arch,packages,githubRunnerName:"maincreate-"+name,lastSeen:new Date().toISOString()});

test("an ESP-IDF 5.5 project requires a compatible SDK version",()=>{
 const requirement=parseRequirements(manifests.esp);
 assert.equal(requirement.status,"declared");
 assert.equal(evaluateProject(requirement,[online("pi","linux","arm64",[{name:"esp-idf",version:"ESP-IDF v5.5.6"}])]).status,"compatible");
 assert.equal(evaluateProject(requirement,[online("pi","linux","arm64",[{name:"esp-idf",version:"ESP-IDF v6.4.0"}])]).status,"missing");
 assert.equal(evaluateProject(requirement,[online("win","windows","x64",[{name:"esp-idf",version:"5.5.6"}])]).status,"missing");
 assert.equal(versionSatisfied("ESP-IDF v5.5.6","5.5.x"),true);
 assert.equal(versionSatisfied("ESP-IDF v6.4.0","5.5.x"),false);
});
test("iOS builds require a managed online Mac with the specified Xcode",()=>{
 const req=parseRequirements(manifests.ios);
 assert.equal(evaluateProject(req,[online("hackintosh","macos","x64",[{name:"xcode",version:"Xcode 16.4"}])]).status,"compatible");
 assert.equal(evaluateProject(req,[online("pi","linux","arm64",[{name:"xcode",version:"Xcode 16.4"}])]).status,"missing");
 assert.equal(evaluateProject(req,[online("hackintosh","macos","x64",[{name:"xcode",version:"Xcode 15.4"}])]).status,"missing");
});
test("missing compatibility is muted when ignored and retained when unignored",()=>{
 const repositories=[{fullName:"MainCreate/WaymarkerOS",archived:false}];
 const requirements=parseRequirements(manifests.esp);
 // An actual check stores the requirement separately; preferences survive future source re-sync.
 setProjectIgnored("MainCreate/WaymarkerOS",true);
 const ignored=projectSummary(repositories,[]);
 assert.equal(ignored.repositories[0].ignored,true);
 assert.equal(ignored.alerts,0);
 setProjectIgnored("MainCreate/WaymarkerOS",false);
 assert.equal(projectSummary(repositories,[]).repositories[0].ignored,false);
});
test("workflow inference records only literal OS and declared tool constraints",()=>{
 const fw=inferRequirementsFromWorkflows([
 'jobs:\n  build:\n    runs-on: macos-15\n    steps:\n      - run: xcodebuild -project App.xcodeproj',
 'jobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: espressif/install-esp-idf\n        with:\n          esp_idf_version: v5.5.6'
 ]);
 assert.equal(fw.status,"inferred");
 assert.deepEqual(fw.targets.find(t=>t.os==="macos").tools,[{name:"xcode",version:null}]);
 assert.deepEqual(fw.targets.find(t=>t.os==="linux").tools,[{name:"esp-idf",version:"5.5.6"}]);
 assert.equal(inferRequirementsFromWorkflows(['runs-on: ${{ matrix.os }}']).status,"unknown");
});
test("invalid manifests do not fabricate a compatible builder",()=>{
 assert.throws(()=>parseRequirements(JSON.stringify({schema:1,targets:[{os:"linux",tools:[{name:"shell",version:"1.0"}]}]})),/Unsupported tool/);
 assert.throws(()=>parseRequirements(JSON.stringify({schema:1,targets:[{os:"linux",tools:[{name:"esp-idf",version:"latest"}]}]})),/Unsupported tool version/);
});
test("GitHub requirement detection prefers versioned project manifest",async()=>{
 const old=globalThis.fetch;
 try{
  globalThis.fetch=async(url,opts)=>{
   assert.ok(opts.headers.authorization.startsWith("Bearer "));
   if(url.endsWith("/.maincreate/project.json"))
    return new Response(JSON.stringify({type:"file",size:manifests.esp.length,encoding:"base64",content:Buffer.from(manifests.esp).toString("base64")}),{status:200});
   throw Error("Unexpected remote read");
  };
  const found=await detectProjectRequirements("MainCreate/WaymarkerOS","short-lived-token");
  assert.equal(found.targets[0].tools[0].version,"5.5.x");
 }finally{globalThis.fetch=old}
});
