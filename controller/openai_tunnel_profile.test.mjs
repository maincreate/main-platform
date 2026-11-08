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
test("UI and runbook do not imply active credentials or Claude support",()=>{
 assert.match(settings,/Not verified · no live tunnel status/);
 assert.match(settings,/Claude:<\/strong> Deferred/);
 assert.match(guide,/Main\{Create\}.*no OpenAI tunnel identity|no OpenAI tunnel identity/);
 assert.match(guide,/ChatGPT/);
});
