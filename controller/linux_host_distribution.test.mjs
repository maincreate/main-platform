import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {HOST_RELEASE,supportsRemoteHostUpgrade} from "./host_routes.mjs";
const root=new URL("../",import.meta.url);
test("both architectures share one checked installer and version",()=>{
 const script=readFileSync(new URL("scripts/install-linux.sh",root),"utf8");
 const dockerfile=readFileSync(new URL("Dockerfile",root),"utf8");
 assert.equal(HOST_RELEASE,"0.8.5");
 assert.match(script,/MAIN_EXPECTED_ARCH/);
 assert.match(script,/aarch64\|arm64/);
 assert.match(script,/x86_64\|amd64/);
 assert.match(script,/sha256sum --check/);
 assert.match(dockerfile,/GOARCH=arm64/);
 assert.match(dockerfile,/GOARCH=amd64/);
 assert.match(dockerfile,/maincreate-host-linux-amd64/);
 assert.ok(supportsRemoteHostUpgrade("0.7.0"));
 assert.ok(!supportsRemoteHostUpgrade("0.6.9"));
});
