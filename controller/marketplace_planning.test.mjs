import {test} from "node:test";
import assert from "node:assert/strict";
import {releases,classifyBuilder,makeInstallationPlan,validateAssignment} from "./marketplace_planning.mjs";
const pi={id:"a",name:"pi-desk",os:"linux",arch:"arm64",managedHost:{host:"pi.local"},
 assignment:{location:"Orlando / desk",assignedTo:"Engineer A"}};
const x64={id:"d",name:"linux-x64",os:"linux",arch:"x64",managedHost:{host:"x64.local"}};
const unmanaged={id:"b",name:"unmanaged",os:"linux",arch:"arm64"};
const mac={id:"c",name:"mac",os:"macos",arch:"arm64",managedHost:{host:"mac.local"}};
const hosts=[pi,unmanaged,mac,x64];

test("Marketplace catalog exposes exact toolkit versions and per-operation compatibility",()=>{
 const esp=releases().find(x=>x.id==="esp-idf@5.5.6");
 assert(esp);assert.equal(classifyBuilder(pi,esp,"install").compatible,true);
 assert.equal(classifyBuilder(x64,esp,"build").compatible,true);
 assert.equal(classifyBuilder(unmanaged,esp,"install").compatible,false);
 assert.equal(classifyBuilder(mac,esp,"install").compatible,false);
 assert(releases().some(x=>x.id==="esp-idf@6.1.1"));
 assert.equal(releases().some(x=>x.id==="esp-idf@6.4"),false);
 const android=releases().find(x=>x.id==="android-sdk@2026.2.2-patch1");
 assert(android);assert.equal(classifyBuilder(x64,android,"install").compatible,true);
 assert.equal(classifyBuilder(pi,android,"install").compatible,false);
 const adb=releases().find(x=>x.id==="android-adb@system");
 assert(adb);assert.equal(classifyBuilder(pi,adb,"install").compatible,true);
});

test("Selected ESP-IDF builders are planned without pretending pilot installers are executable",()=>{
 const plan=makeInstallationPlan({family:"esp-idf",version:"5.5.6",placement:"selected",builder_ids:["a"]},hosts,"tester");
 assert.equal(plan.targets.length,1);assert.equal(plan.targets[0].location,"Orlando / desk");
 assert.equal(plan.installable,false);assert.equal(plan.installState,"pilot");
 assert.equal(plan.platformCapabilityState,"unavailable");
 assert.equal(plan.execution,"not_started");assert.equal(plan.status,"planned");
 assert.equal(plan.targets[0].status,"awaiting_validated_installer");
 assert.equal(plan.job_ids,undefined);
});

test("Arduino CLI plan references its available installer capability",()=>{
 const plan=makeInstallationPlan({family:"arduino-cli",version:"1.5.1",placement:"selected",builder_ids:["a"]},hosts,"tester");
 assert.equal(plan.installable,true);
 assert.equal(plan.installCapabilityId,"sdk.arduino_cli.install");
 assert.equal(plan.platformCapabilityState,"available");
 assert.equal(plan.execution,"not_started");assert.equal(plan.job_ids,undefined);
});

test("All-compatible is derived from exact install host compatibility",()=>{
 const plan=makeInstallationPlan({family:"arduino-cli",version:"1.5.1",placement:"all-compatible"},hosts,"tester");
 assert.deepEqual(plan.targets.map(x=>x.builderId),["a","d"]);
});

test("Explicit all-compatible does not accept selected IDs",()=>{
 assert.throws(()=>makeInstallationPlan({family:"esp-idf",version:"5.5.6",placement:"all-compatible",builder_ids:["a"]},hosts,"tester"));
});

test("Selected targets reject unmanaged hosts, duplicates and invalid release",()=>{
 for(const input of [
  {family:"esp-idf",version:"5.5.6",placement:"selected",builder_ids:["b"]},
  {family:"esp-idf",version:"5.5.6",placement:"selected",builder_ids:["a","a"]},
  {family:"esp-idf",version:"999.0",placement:"selected",builder_ids:["a"]}
 ])assert.throws(()=>makeInstallationPlan(input,hosts,"tester"));
});

test("Builder metadata is bounded and separated from identity",()=>{
 assert.deepEqual(validateAssignment({displayName:"Pi desk",location:"Orlando / Desk 1",assignedTo:"Engineer A",accessGroup:"firmware"}),{
  displayName:"Pi desk",location:"Orlando / Desk 1",assignedTo:"Engineer A",accessGroup:"firmware"
 });
 assert.throws(()=>validateAssignment({displayName:"\n",location:"",assignedTo:"",accessGroup:""}));
});
