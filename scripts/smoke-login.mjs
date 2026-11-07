#!/usr/bin/env node
// Optional client-side smoke check for an already-created admin account.
// Login credentials are not configured as server environment variables.
import assert from "node:assert/strict";

const url = new URL(process.env.TT_PORTAL_URL || "http://127.0.0.1:13000");
const username = process.env.TT_LOGIN_USERNAME || "";
const password = process.env.TT_LOGIN_PASSWORD || "";
if (!username || !password) throw new Error("Set TT_LOGIN_USERNAME and TT_LOGIN_PASSWORD for this one-off client-side smoke check");
if (url.username || url.password) throw new Error("Credentials must not be embedded in the URL");
if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) {
  throw new Error("Refusing to send password over non-loopback HTTP");
}
url.pathname = "/"; url.search = ""; url.hash = "";

const check = async (path, options = {}) =>
  fetch(new URL(path, url), {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...options,
  });

async function run() {
  const health = await check("/healthz");
  assert.equal(health.status, 200, "Health endpoint must return 200");

  const setup = await check("/setup");
  assert.equal(setup.status, 200, "Login page must be available");

  const anonymous = await check("/");
  assert.equal(anonymous.status, 302, "Anonymous dashboard must redirect to login");
  assert.equal(anonymous.headers.get("location"), "/setup");

  const status = await (await check("/api/local/public")).json();
  assert.equal(status.claimed, true, "An administrator must already be created in the portal");

  const login = await check("/api/local/login", {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({username,password})
  });
  assert.equal(login.status, 200, "Admin login must succeed");
  const loginResponse = await login.json();
  assert.equal(loginResponse.authenticated, true);
  assert.equal(typeof loginResponse.csrf, "string");
  const sessionCookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(sessionCookie?.startsWith("ttsid="), "Server must set an HTTP-only session cookie");
  assert.match(login.headers.get("set-cookie") || "", /; HttpOnly;/);

  const authorized = await check("/", {headers:{cookie:sessionCookie}});
  assert.equal(authorized.status, 200, "Authenticated dashboard must load");

  const logout = await check("/api/local/logout", {
    method: "POST",
    headers: {
      "content-type":"application/json",
      cookie:sessionCookie,
      "x-tt-csrf":loginResponse.csrf
    },
    body: "{}"
  });
  assert.equal(logout.status, 200, "Logout must succeed");

  const afterLogout = await check("/", {headers:{cookie:sessionCookie}});
  assert.equal(afterLogout.status, 302, "Logged-out session must not see dashboard");

  process.stdout.write("PASS: portal health, login page, anonymous redirect, admin session, dashboard, logout\n");
}
run().catch(error => {
  process.stderr.write("FAIL: portal login smoke test: " + (error?.message || "unknown error") + "\n");
  process.exitCode = 1;
});
