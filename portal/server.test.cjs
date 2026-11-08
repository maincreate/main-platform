const test = require("node:test");
const assert = require("node:assert/strict");
const {spawn} = require("node:child_process");
const {createServer} = require("node:net");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

test("local Node portal serves marketplace and denies execution", {timeout: 12000}, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: __dirname,
    env: {...process.env, PORT:String(port), MAIN_REQUIRE_LOGIN:"0"},
    stdio:"ignore"
  });
  const base = "http://127.0.0.1:" + port;
  try {
    let ready = false;
    for (let i=0; i<50; i++) {
      if (child.exitCode !== null) throw new Error("Portal exited before serving");
      try {const r=await fetch(base+"/healthz");if(r.ok){ready=true;break}}catch{}
      await new Promise(resolve => setTimeout(resolve,80));
    }
    assert(ready, "Local portal did not start");
    const home=await fetch(base+"/");
    assert.equal(home.status,200);
    assert.match(await home.text(), /Main{Create} • Portal/);
    const frameworks=await (await fetch(base+"/api/v1/catalog")).json();
    assert(frameworks.frameworks.some(x=>x.id==="esp-idf"));
    const plan=await fetch(base+"/api/v1/plans",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({framework:"esp-idf",os:"linux",arch:"arm64"})});
    assert.equal(plan.status,200);
    assert.equal((await plan.json()).status,"dry_run");
    assert.equal((await fetch(base+"/mcp")).status,503);
    assert.equal((await fetch(base+"/api/v1/install",{method:"POST"})).status,503);
    assert.equal((await fetch(base+"/api/v1/enroll",{method:"POST"})).status,503);
  } finally {
    child.kill("SIGTERM");
  }
});
