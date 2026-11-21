import {test} from "node:test";
import assert from "node:assert/strict";
import {marketplaceView,verifiedInstall,projectReadiness,validVersion} from "./marketplace_state.mjs";
import {releases} from "./marketplace_planning.mjs";

const arduino=releases().find(r=>r.family==="arduino-cli"&&r.version==="1.5.1");
const idf=releases().find(r=>r.family==="esp-idf"&&r.version==="5.5.6");
const now=()=>new Date().toISOString();
const host=(id,arch,packages=[],capabilities=["host.snapshot","sdk.arduino_cli.install"])=>({
 id,name:"builder-"+id,os:"linux",arch,managedHost:{type:"managed"},
 packages,githubRunnerName:"github-"+id,lastSeen:now(),fabricObservedAt:now(),
 fabricCapabilities:capabilities
});
test("only version-confirmed Host Service packages count as installed",()=>{
 assert(arduino);
 const h=host("a","arm64",[{name:"arduino-cli",version:"Arduino CLI 1.5.1"}]);
 assert.equal(verifiedInstall(h,arduino)?.state,"installed");
 assert.equal(verifiedInstall(host("b","x64",[{name:"arduino-cli",version:"Arduino CLI 1.5.0"}]),arduino),null);
 assert.equal(verifiedInstall(host("c","x64",[{name:"arduino-cli",version:"Not Arduino 1.5.1"}]),arduino),null);
 assert.equal(validVersion("Arduino CLI 1.5.11","1.5.1"),false);
});
test("shared Marketplace inventory distinguishes installed, queued and verifying",()=>{
 const a=host("a","arm64",[{name:"arduino-cli",version:"Arduino CLI 1.5.1"}]);
 const b=host("b","x64");
 const jobs=[{id:"job-1",status:"completed"}];
 const operations=[{id:"op",family:"arduino-cli",version:"1.5.1",
  targets:[{builderId:"b",hostname:"builder-b",jobId:"job-1",status:"queued"}]}];
 const result=marketplaceView([a,b],operations,jobs,[]);
 assert.equal(result.software.find(x=>x.id==="arduino-cli").installed_host_count,1);
 assert.deepEqual(result.hosts.find(x=>x.id==="a").installed,[{family:"arduino-cli",version:"1.5.1"}]);
 assert.equal(result.operations[0].targets[0].state,"verifying");
 assert.equal(marketplaceView([a,host("b","x64",[{name:"arduino-cli",version:"Arduino CLI 1.5.1"}])],
  operations,jobs,[]).operations[0].targets[0].state,"installed");
});
test("project build readiness requires installed SDK and actual build executor",()=>{
 assert(idf);
 const req={status:"declared",targets:[{os:"linux",arch:"arm64",
  tools:[{name:"esp-idf",version:"5.5.x"}]}]};
 const uninstalled=host("a","arm64",[]);
 assert.equal(projectReadiness(req,[uninstalled]).status,"setup_needed");
 const onlyInstalled=host("a","arm64",[{name:"esp-idf",version:"ESP-IDF 5.5.6"}]);
 assert.equal(projectReadiness(req,[onlyInstalled]).status,"setup_needed");
 const ready=host("a","arm64",[{name:"esp-idf",version:"ESP-IDF 5.5.6"}],
  ["host.snapshot","firmware.esp_idf.build"]);
 const state=projectReadiness(req,[ready]);
 assert.equal(state.status,"ready");assert.equal(state.ready,1);
 assert.equal(projectReadiness(req,[host("x","arm64",[{name:"esp-idf",version:"ESP-IDF 5.5.5"}],
  ["firmware.esp_idf.build"])]).status,"setup_needed");
 assert.equal(projectReadiness(req,[host("other","x64")]).status,"unavailable");
 assert.equal(projectReadiness({status:"unknown",targets:[]},[ready]).status,"unknown");
});
