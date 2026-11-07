const test = require("node:test");
const assert = require("node:assert/strict");

test("Penpot MVP workspace routes provide separated, editable UI without a new execution engine", async () => {
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
    assert.match(builders, /id="invite"/);
    assert.match(builders, /GitHub Actions runner registration is a separate step/);
    const jobs = await page("/jobs");
    assert.match(jobs, /id="planForm"/);
    assert.match(jobs, /id="jobs-list"/);
    assert.doesNotMatch(jobs, /id="runners-list"/);
    const marketplace = await page("/marketplace");
    assert.match(marketplace, /id="marketplaceRows"/);
    assert.match(marketplace, /Catalog is currently read-only/);
    const script = await page("/marketplace.js");
    assert.match(script, /api\/v1\/catalog/);
    const overview = await page("/projects");
    assert.match(overview, /href="\/builders"/);
    assert.match(overview, /href="\/marketplace"/);
  } finally {
    if (previous === undefined) delete process.env.TT_REQUIRE_LOGIN;
    else process.env.TT_REQUIRE_LOGIN = previous;
  }
});
