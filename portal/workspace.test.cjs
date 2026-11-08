const test = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");

test("Penpot MVP workspace routes provide separated, editable UI without a new execution engine", async () => {
  for (const dockerfile of [resolve(__dirname, "../Dockerfile"), resolve(__dirname, "Dockerfile")]) {
    const contents = readFileSync(dockerfile, "utf8");
    for (const artifact of ["portal/builders.html", "portal/builders.js", "portal/marketplace.html", "portal/marketplace.js", "portal/actions.js"]) {
      assert(contents.includes(artifact), dockerfile + " must ship " + artifact);
    }
  }
  const previous = process.env.TT_REQUIRE_LOGIN;
  process.env.TT_REQUIRE_LOGIN = "0";
  try {
    const {localRoute} = await import("../controller/routes.mjs");
    async function page(path) {
      const response = await localRoute(new Request("http://localhost" + path));
      assert(response, path + " should be locally routed");
      assert.equal(response.status, 200, path);
      return response.text();
    }
    const builders = await page("/builders");
    assert.match(builders, /id="runners-list"/);
    assert.match(builders, /id="addBuilderDialog"/);
    assert.match(builders, /id="hostAddress"/);
    assert.match(builders, /id="hostUsername"/);
    assert.match(builders, /id="hostPassword"/);
    assert.match(builders, /GitHub Actions runners/);
    const jobs = await page("/jobs");
    assert.doesNotMatch(jobs, /id="planForm"/);
    assert.match(jobs, /id="flashDialog"/);
    assert.match(jobs, /id="githubActionsRuns"/);
    assert.match(jobs, /id="jobs-list"/);
    assert.doesNotMatch(jobs, /id="runners-list"/);
    const marketplace = await page("/marketplace");
    assert.match(marketplace, /id="marketplaceRows"/);
    assert.match(marketplace, /id="marketplaceTiles"/);
    assert.match(marketplace, /id="tileView"/);
    assert.match(marketplace, /id="listView"/);
    assert.match(marketplace, /Catalog is currently read-only/);
    const devices = await page("/devices");
    assert.match(devices, /id="deviceSearch"/);
    assert.match(devices, /id="deviceHost"/);
    assert.match(devices, /id="showHidden"/);
    assert.doesNotMatch(devices, /id="filter"/);
    const dashboardScript = await page("/dashboard.js");
    assert.match(dashboardScript, /30000/);
    const buildersScript = await page("/builders.js");
    assert.match(buildersScript, /runners-list/);
    const gitHub = await page("/github");
    assert.match(gitHub, /workspace.css/);
    const jobPage = await page("/jobs");
    assert.match(jobPage, /id="actionSearch"/);
    assert.match(jobPage, /id="localJobSearch"/);
    const script = await page("/marketplace.js");
    assert.match(script, /api\/v1\/catalog/);
    const settings = await page("/settings");
    assert.match(settings, /id="defaultVisibility"/);
    assert.match(settings, /id="repoRequests"/);
    assert.match(settings, /id="buildApproval"/);
    assert.match(settings, /id="resetForm"/);
    const projectsPage = await page("/projects");
    assert.match(projectsPage, /id="newRepoDialog"/);
    assert.match(projectsPage, /\+ New Project/);
    assert.match(projectsPage, /id="newRepoVisibility"/);
    assert.match(projectsPage, /id="projectSearch"/);
    assert.match(projectsPage, /id="projectFilter"/);
    const overview = await page("/projects");
    assert.match(overview, /href="\/builders"/);
    assert.match(overview, /href="\/marketplace"/);
  } finally {
    if (previous === undefined) delete process.env.TT_REQUIRE_LOGIN;
    else process.env.TT_REQUIRE_LOGIN = previous;
  }
});
