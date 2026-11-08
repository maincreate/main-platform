const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");

test("workspace serves current builder, marketplace, and job experiences",async()=>{
 const dockerfile=resolve(__dirname,"../Dockerfile");
 const content=readFileSync(dockerfile,"utf8");
 for(const asset of ["portal/builders.html","portal/builders.js","portal/dashboard.html","portal/dashboard.js",
  "portal/marketplace.html","portal/marketplace.js","portal/jobs.html","portal/jobs.js","portal/activity.css"])
  assert.ok(content.includes(asset),dockerfile+" must ship "+asset);
 const prior=process.env.MAIN_REQUIRE_LOGIN;
 process.env.MAIN_REQUIRE_LOGIN="0";
 try{
  const {localRoute}=await import("../controller/routes.mjs");
  async function page(path){
   const response=await localRoute(new Request("http://localhost"+path));
   assert.ok(response,"Route absent: "+path);
   assert.equal(response.status,200,path);
   return response.text();
  }
  const builders=await page("/builders");
  for(const id of ["runners-list","addBuilderDialog","addBuilderProgress","addBuilderStages","removeBuilderDialog","upgradeBuilderDialog","copyInstallCommand","pairHost","hostFingerprint","hostPassword","githubRunners"])
   assert.ok(builders.includes('id="'+id+'"'),"Builders missing "+id);
  for(const id of ["removeBuilderIdentityStep","removeBuilderNameReference","copyRemoveBuilderName",
   "continueRemoveBuilder","removeBuilderPasswordStep","backRemoveBuilder","removeBuilderProgress"])
   assert.ok(builders.includes('id="'+id+'"'),"Staged removal missing "+id);
  const buildersScript=await page("/builders.js");
  for(const feature of ["renderBuilders","validateBuilder","dismissDialogOnBackdrop","openUpgradeDialog","maincreate-runner-label-editor","renderSetupTimeline","pollSetupProgress","openSetupProgress","setupFailure"])
   assert.ok(buildersScript.includes(feature),"Builder script missing "+feature);
  assert.ok(!buildersScript.includes('prompt("Comma-separated'),"Labels must not use a browser prompt");
  assert.ok(buildersScript.includes("setRemovalStep(2)"),"Name confirmation must precede password");
  assert.ok(buildersScript.includes("removalConfirmationStep!==2"),"Removal submission must require password stage");
  assert.ok(buildersScript.includes("navigator.clipboard.writeText(removeTarget.name)"),"Name must be copyable");
  const jobs=await page("/jobs");
  for(const id of ["jobs-list","githubActionsRuns","flashDialog"])
   assert.ok(jobs.includes('id="'+id+'"'),"Jobs missing "+id);
  const marketplace=await page("/marketplace");
  assert.ok(marketplace.includes("Marketplace"));
  assert.ok(marketplace.includes('id="mcuCatalog"'));
  const marketplaceJs=await page("/marketplace.js");
  assert.ok(marketplaceJs.includes("renderMicrocontrollers"));
  const devices=await page("/devices");
  assert.ok(devices.includes("Devices"));
  assert.ok(devices.includes('id="deviceCompatibilityPanel"'));
  const deviceScript=await page("/devices.js");
  assert.ok(deviceScript.includes("showCompatibility"));
  assert.ok(deviceScript.includes("candidateChips"));

  const overview=readFileSync(resolve(__dirname,"dashboard.html"),"utf8");
  const dashboardScript=await page("/dashboard.js");
  assert.ok(dashboardScript.includes("loadActivity"));
  assert.ok(dashboardScript.includes("getBoundingClientRect().width"),"Activity chart must measure its container width");
  assert.ok(dashboardScript.includes("ResizeObserver"),"Activity chart must respond to panel resize");
  assert.ok(!dashboardScript.includes("width=960,height=230"),"Activity chart must not use a fixed 960px plot");
  for(const id of ["activityChart","activityDetails","recentJobs"])
   assert.ok(overview.includes('id="'+id+'"'),"Overview missing "+id);
  const activityStyle=await page("/activity.css");
  assert.ok(activityStyle.includes(".maincreate-activity-chart"));
 }finally{
  if(prior===undefined)delete process.env.MAIN_REQUIRE_LOGIN;
  else process.env.MAIN_REQUIRE_LOGIN=prior;
 }
});
