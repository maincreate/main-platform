const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");

test("workspace serves current builder, marketplace, and job experiences",async()=>{
 for(const dockerfile of [resolve(__dirname,"../Dockerfile"),resolve(__dirname,"Dockerfile")]){
  const content=readFileSync(dockerfile,"utf8");
  for(const asset of ["portal/builders.html","portal/builders.js","portal/dashboard.html","portal/dashboard.js",
   "portal/marketplace.html","portal/marketplace.js","portal/jobs.html","portal/jobs.js","portal/activity.css"])
   assert.ok(content.includes(asset),dockerfile+" must ship "+asset);
 }
 const prior=process.env.TT_REQUIRE_LOGIN;
 process.env.TT_REQUIRE_LOGIN="0";
 try{
  const {localRoute}=await import("../controller/routes.mjs");
  async function page(path){
   const response=await localRoute(new Request("http://localhost"+path));
   assert.ok(response,"Route absent: "+path);
   assert.equal(response.status,200,path);
   return response.text();
  }
  const builders=await page("/builders");
  for(const id of ["runners-list","addBuilderDialog","removeBuilderDialog","upgradeBuilderDialog","copyInstallCommand","pairHost","hostFingerprint","hostPassword","githubRunners"])
   assert.ok(builders.includes('id="'+id+'"'),"Builders missing "+id);
  const buildersScript=await page("/builders.js");
  for(const feature of ["renderBuilders","validateBuilder","dismissDialogOnBackdrop","openUpgradeDialog","tt-runner-label-editor"])
   assert.ok(buildersScript.includes(feature),"Builder script missing "+feature);
  assert.ok(!buildersScript.includes('prompt("Comma-separated'),"Labels must not use a browser prompt");
  const jobs=await page("/jobs");
  for(const id of ["jobs-list","githubActionsRuns","flashDialog"])
   assert.ok(jobs.includes('id="'+id+'"'),"Jobs missing "+id);
  const marketplace=await page("/marketplace");
  assert.ok(marketplace.includes("Marketplace"));
  const devices=await page("/devices");
  assert.ok(devices.includes("Devices"));
  const overview=readFileSync(resolve(__dirname,"dashboard.html"),"utf8");
  const dashboardScript=await page("/dashboard.js");
  assert.ok(dashboardScript.includes("loadActivity"));
  for(const id of ["activityChart","activityDetails","recentJobs"])
   assert.ok(overview.includes('id="'+id+'"'),"Overview missing "+id);
  const activityStyle=await page("/activity.css");
  assert.ok(activityStyle.includes(".tt-activity-chart"));
 }finally{
  if(prior===undefined)delete process.env.TT_REQUIRE_LOGIN;
  else process.env.TT_REQUIRE_LOGIN=prior;
 }
});
