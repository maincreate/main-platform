import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const dir=new URL("../portal/",import.meta.url);
const pages=["dashboard","builders","devices","projects","jobs","marketplace","topology","settings","github"];
for(const page of pages) {
 test(page+" retains a single left nav and new wordmark",()=>{
  const html=readFileSync(new URL(page+".html",dir),"utf8");
  const sidebar=html.match(/<aside class="maincreate-sidebar"[\s\S]*?<\/aside>/)?.[0];
  const topbar=html.match(/<header class="maincreate-app-topbar"[\s\S]*?<\/header>/)?.[0];
  assert.ok(sidebar);assert.ok(topbar);
  assert.match(sidebar,/class="maincreate-brand-lockup"/);
  assert.match(sidebar,/class="maincreate-platform-label">PLATFORM<\/span>/);
  assert.match(sidebar,/class="maincreate-brand-brace">\{<\/span>Create<span class="maincreate-brand-brace">}<\/span>/);
  assert.match(sidebar,/class="maincreate-sidebar-label">WORKSPACE<\/span>/);
  assert.doesNotMatch(sidebar,/maincreate-logo|M\{\}/);
  assert.equal((html.match(/class="maincreate-nav"/g)||[]).length,1);
  for(const url of ["/","/projects","/builders","/devices","/jobs","/marketplace","/topology","/settings"])assert.ok(sidebar.includes('href="'+url+'"'));
  assert.doesNotMatch(topbar,/GitHub organization|workspaceOrg|<nav/);
  assert.match(topbar,/id="username"/);assert.match(topbar,/id="signout"/);
 });
}
test("header and sidebar branding align at 73px and preserve mobile nav",()=>{
 const css=readFileSync(new URL("workspace.css",dir),"utf8");
 assert.match(css,/\.maincreate-brand-lockup\{height:73px;[^}]*border-bottom:1px solid var\(--line\)/);
 assert.match(css,/\.maincreate-app-topbar\{[^}]*height:73px;[^}]*border-bottom:1px solid var\(--line\)/);
 assert.match(css,/\.maincreate-app-topbar\{[^}]*justify-content:flex-end/);
 assert.match(css,/\.maincreate-brand-brace\{color:#0ea5b4\}/);
 assert.match(css,/\.maincreate-nav\{display:flex;flex-direction:column/);
});
test("Overview no longer updates removed org label",()=>{
 assert.doesNotMatch(readFileSync(new URL("dashboard.js",dir),"utf8"),/workspaceOrg/);
});

test("sidebar branding spans full width with no vertical line above the 73px boundary",()=>{
 const css=readFileSync(new URL("workspace.css",dir),"utf8");
 assert.match(css,/\.maincreate-sidebar\{[^}]*border-right:0/);
 assert.match(css,/\.maincreate-sidebar::after\{[^}]*top:73px;right:0;bottom:0;width:1px/);
 assert.match(css,/\.maincreate-brand-lockup\{height:73px;[^}]*margin:0 -14px 4px/);
 assert.match(css,/\.maincreate-sidebar::after\{display:none\}/);
});
test("login and first-run setup share the approved wordmark and PLATFORM caption",()=>{
 const login=readFileSync(new URL("setup.html",dir),"utf8");
 const css=readFileSync(new URL("setup.css",dir),"utf8");
 assert.match(login,/class="maincreate-brand-lockup maincreate-auth-lockup"/);
 assert.match(login,/class="maincreate-platform-label">PLATFORM<\/span>/);
 assert.match(login,/class="maincreate-brand-brace">\{<\/span>Create<span class="maincreate-brand-brace">}<\/span>/);
 assert.doesNotMatch(login,/class="logo"|<p class="eyebrow">Main\{Create\}<\/p>/);
 assert.match(css,/\.maincreate-auth-lockup \.maincreate-brand-brace\{color:#0ea5b4\}/);
 assert.match(css,/\.maincreate-auth-lockup \.maincreate-platform-label\{[^}]*text-align:center/);
});

test("login wordmark uses full left-column width and responsive centered lettering",()=>{
 const css=readFileSync(new URL("setup.css",dir),"utf8");
 const html=readFileSync(new URL("setup.html",dir),"utf8");
 assert.match(css,/\.intro\{max-width:500px;container-type:inline-size\}/);
 assert.match(css,/\.maincreate-auth-lockup\{[^}]*width:100%;[^}]*text-align:center\}/);
 assert.match(css,/\.maincreate-auth-lockup \.maincreate-brand\{[^}]*justify-content:center;[^}]*font-size:clamp\(34px,14cqw,70px\)/);
 assert.match(css,/\.maincreate-auth-lockup \.maincreate-platform-label\{[^}]*font-size:clamp\(11px,2.4cqw,13px\);[^}]*text-align:center\}/);
 assert.match(html,/\/setup\.css\?v=column-brand-20261109/);
});
