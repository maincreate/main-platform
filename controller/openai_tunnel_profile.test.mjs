import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../",import.meta.url);
const text=path=>readFileSync(new URL(path,root),"utf8");
const compose=text("compose.yaml"),settings=text("portal/settings.html"),guide=text("docs/openai-secure-mcp-tunnel.md");
const tunnel=compose.split("\n  openai-tunnel:\n",2)[1]?.split("\n  runner:\n",1)[0];

test("OpenAI transport is optional and outbound-only, without host network publication",()=>{
 assert.ok(tunnel,"Missing OpenAI Compose profile");
 assert.match(tunnel,/profiles: \["openai-tunnel"\]/);
 assert.match(tunnel,/ghcr\.io\/openai\/tunnel-client:v\d+\.\d+\.\d+/);
 assert.match(tunnel,/MCP_SERVER_URL: http:\/\/gateway:3001\/mcp/);
 assert.doesNotMatch(tunnel,/\n\s+ports:|network_mode:\s*host|privileged:\s*true|docker\.sock/);
 assert.match(tunnel,/read_only: true/);
 assert.match(tunnel,/cap_drop: \["ALL"\]/);
});
test("OpenAI runtime secrets are file mounted and no runtime credential is in the UI",()=>{
 assert.match(tunnel,/CONTROL_PLANE_API_KEY: file:\/run\/secrets\/openai_runtime_api_key/);
 assert.match(tunnel,/MCP_EXTRA_HEADERS: "Authorization: file:\/run\/secrets\/main_mcp_auth_header"/);
 assert.match(compose,/secrets:\n  openai_runtime_api_key:\n/);
 assert.match(compose,/  main_mcp_auth_header:\n/);
 assert.doesNotMatch(settings,/id="openaiApiKey"|id="mainMcpToken"/);
 assert.match(text(".gitignore"),/secrets\//);
});
test("Settings drives a real three-step connection without user environment variables",()=>{
 assert.match(settings,/id="openaiConnectionForm"/);
 assert.match(settings,/id="openaiTunnelId"/);
 assert.match(settings,/id="openaiRuntimeKey" type="password"/);
 assert.match(settings,/id="openaiConnect"/);
 assert.match(settings,/id="openaiDisconnect"/);
 assert.match(settings,/id="openaiForget"/);
 assert.match(settings,/id="openaiTunnelStatus"/);
 assert.doesNotMatch(settings,/MAIN_OPENAI_TUNNEL_ID|docker compose --profile|MAIN_MCP_TOKEN/);
 assert.match(guide,/Settings → Connect ChatGPT/);
 assert.match(guide,/ChatGPT/);
 assert.match(settings,/Claude is deferred/);
});
test("Bundled portal includes the official tunnel-client and private local MCP service",()=>{
 const image=text("Dockerfile");
 const runtime=text("controller/openai_tunnel_runtime.mjs");
 assert.match(image,/FROM ghcr\.io\/openai\/tunnel-client:v0\.0\.19 AS openai-client/);
 assert.match(image,/COPY --from=openai-client \/usr\/bin\/tunnel-client \/usr\/bin\/tunnel-client/);
 assert.match(image,/COPY --chown=node:node gateway\/server\.mjs \.\/gateway\//);
 assert.match(runtime,/HOST:"127\.0\.0\.1"/);
 assert.match(runtime,/--control-plane\.api-key=file:/);
 assert.match(runtime,/--mcp\.extra-headers=X-MainCreate-Private-Token: file:/);
 assert.doesNotMatch(runtime,/shell:true|0\.0\.0\.0/);
 const gateway=text("gateway/server.mjs");
 assert.match(gateway,/privateBridgeToken=process\.env\.MAIN_PRIVATE_MCP_TOKEN/);
 assert.match(gateway,/x-maincreate-private-token/);
 assert.match(gateway,/authorization\|\|""/);
});
