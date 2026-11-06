const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

let handler;
const source = fs.readFileSync(path.join(__dirname, "worker.js"), "utf8");
vm.runInNewContext(source, {
  addEventListener(name, callback) { if (name === "fetch") handler = callback; },
  Request, Response, URL, console
}, { filename: "worker.js" });

function send(url, init) {
  let response;
  handler({request: new Request("https://portal.tinkertunnel.com" + url, init),
    respondWith(promise) { response = promise; }});
  return response;
}

test("serves branded portal with self-hosted script", async () => {
  const response = await send("/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /TinkerTunnel • Portal/);
  assert.match(response.headers.get("Content-Security-Policy"), /script-src 'self'/);
  const script = await send("/portal.js");
  assert.equal(script.status, 200);
  assert.match(await script.text(), /function planDialog/);
});

test("marketplace includes OS-aware targets", async () => {
  const r = await send("/api/v1/catalog");
  const body = await r.json();
  assert.equal(r.status, 200);
  const esp = body.frameworks.find(x => x.id === "esp-idf");
  assert(esp.targets.some(x => x.os === "linux" && x.arch === "arm64"));
  assert(esp.targets.some(x => x.os === "windows" && x.arch === "x64"));
  assert(esp.targets.some(x => x.os === "macos" && x.arch === "arm64"));
});

test("plans are read-only and reject unsupported target combinations", async () => {
  const init = (obj) => ({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(obj)});
  const r = await send("/api/v1/plans",init({framework:"esp-idf",os:"linux",arch:"arm64"}));
  const body = await r.json();
  assert.equal(body.status,"dry_run");
  assert.equal(body.execution,"Disabled (no authenticated agent or approved installer)");
  assert(body.dependencies.length > 0);
  const invalid = await send("/api/v1/plans",init({framework:"esp-idf",os:"plan9",arch:"mips"}));
  assert.equal(invalid.status,422);
  assert.equal((await send("/api/v1/plans",init({framework:"does-not-exist",os:"linux",arch:"arm64"}))).status,404);
});

test("unconnected status is honest and execution endpoints fail closed", async () => {
  const s = await send("/api/v1/status");
  const state = await s.json();
  assert.equal(state.connections.github.verified,false);
  assert.equal(state.connections.agent.verified,false);
  assert.equal(state.connections.mcp.verified,false);
  assert.equal(s.headers.get("Cache-Control"),"no-store");
  assert.equal((await send("/mcp")).status,503);
  assert.equal((await send("/api/v1/install",{method:"POST"})).status,503);
  assert.equal((await send("/api/v1/enroll",{method:"POST"})).status,503);
});

test("bad JSON and overlong inputs rejected", async () => {
  assert.equal((await send("/api/v1/plans",{method:"POST",headers:{"Content-Type":"application/json"},body:"{"})).status,400);
  assert.equal((await send("/api/v1/plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({x:"a".repeat(4200)})})).status,413);
});
