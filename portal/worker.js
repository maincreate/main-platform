/* Main{Create} portal developer preview: all installation actions intentionally disabled.
 * The catalog and dry-run plan are intentionally public; credentials and node data are never exposed.
 * Replace static status with authenticated, tenant-scoped data before enabling any connections. */
const PORTAL_HTML = "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"description\" content=\"Main{Create} portal: connect GitHub, enroll local builders, configure MCP and plan approved framework installations.\">\n<title>Main{Create} • Portal</title><link rel=\"stylesheet\" href=\"/portal.css\"></head>\n<body>\n<div class=\"shell\">\n  <aside class=\"sidebar\">\n    <a class=\"brand\" href=\"/\"><span class=\"brand-mark\">T<span>↗</span></span><span>Main{Create}<small>WORKSPACE PORTAL</small></span></a>\n    <div class=\"nav-caption\">WORKSPACE</div>\n    <nav aria-label=\"Portal\">\n      <button class=\"nav-link active\" data-view=\"overview\"><span class=\"nav-icon\">◈</span> Overview</button>\n      <button class=\"nav-link\" data-view=\"connections\"><span class=\"nav-icon\">⇄</span> Connections</button>\n      <a class=\"nav-link\" href=\"/setup\" style=\"display:block\"><span class=\"nav-icon\">⚙</span> Setup</a>\n      <button class=\"nav-link\" data-view=\"marketplace\"><span class=\"nav-icon\">▦</span> Marketplace</button>\n      <button class=\"nav-link\" data-view=\"runners\"><span class=\"nav-icon\">▤</span> Build nodes</button>\n      <button class=\"nav-link\" data-view=\"activity\"><span class=\"nav-icon\">≡</span> Activity</button>\n    </nav>\n    <div class=\"side-bottom\"><div class=\"side-note\"><span class=\"status-dot amber\"></span><div><strong>Developer preview</strong><small>No account or agent enrolled</small></div></div><a href=\"https://github.com/maincreate\" target=\"_blank\" rel=\"noopener noreferrer\">View source ↗</a></div>\n  </aside>\n  <div class=\"main-shell\">\n    <header class=\"topbar\"><div><span class=\"crumb\">Workspace</span><span class=\"slash\">/</span><strong id=\"view-title\">Overview</strong></div><div class=\"top-actions\"><span class=\"environment\">PREVIEW ENVIRONMENT</span><a class=\"help-link\" href=\"https://github.com/maincreate/main-platform\" target=\"_blank\" rel=\"noopener noreferrer\">Documentation ↗</a></div></header>\n    <main id=\"content\">\n      <section data-page=\"overview\">\n        <div class=\"hero\"><div><div class=\"eyebrow\"><span class=\"pulse\"></span> YOUR DEVELOPMENT FABRIC</div><h1>Build from anywhere.<br><em>Run on your hardware.</em></h1><p>Connect your AI assistant, source code, and trusted machines. Install approved frameworks and execute repeatable workflows without exposing your network.</p><button class=\"primary-button\" data-go=\"connections\">Complete setup <span>→</span></button></div><div class=\"hero-art\" aria-hidden=\"true\"><div class=\"mesh-circle ring1\"></div><div class=\"mesh-circle ring2\"></div><div class=\"mesh-circle ring3\"></div><div class=\"hero-core\">T<span>↗</span></div><span class=\"mesh-tag tag1\">MCP</span><span class=\"mesh-tag tag2\">GITHUB</span><span class=\"mesh-tag tag3\">AGENT</span></div></div>\n        <div class=\"section-header\"><div><span class=\"section-kicker\">GET STARTED</span><h2>Your connection checklist</h2></div><span class=\"muted\" id=\"step-count\">0 of 3 verified</span></div>\n        <div class=\"steps-grid\">\n          <article class=\"step-card\"><div class=\"step-top\"><span class=\"step-number\">01 / GITHUB</span><span class=\"state-pill pending\" id=\"github-state\">Not connected</span></div><div class=\"step-glyph\">⌘</div><h3>Connect your source</h3><p>Authorize the repositories and organizations Main{Create} can use, with explicit installation permissions.</p><button class=\"text-action\" data-go=\"connections\">Configure GitHub <span>→</span></button></article>\n          <article class=\"step-card\"><div class=\"step-top\"><span class=\"step-number\">02 / SECURE AGENT</span><span class=\"state-pill pending\" id=\"agent-state\">Not enrolled</span></div><div class=\"step-glyph\">⌁</div><h3>Pair your machines</h3><p>Enroll Raspberry Pi, macOS or Windows nodes over outbound-only connections. No router port forwarding.</p><button class=\"text-action\" data-go=\"connections\">Configure agent <span>→</span></button></article>\n          <article class=\"step-card\"><div class=\"step-top\"><span class=\"step-number\">03 / CHATGPT MCP</span><span class=\"state-pill pending\" id=\"mcp-state\">Not verified</span></div><div class=\"step-glyph\">✳</div><h3>Connect your assistant</h3><p>Add the authenticated MCP connection in ChatGPT, then verify it with a real discovery request.</p><button class=\"text-action\" data-go=\"connections\">MCP instructions <span>→</span></button></article>\n        </div>\n        <div class=\"section-header compact\"><div><span class=\"section-kicker\">TOOLCHAINS</span><h2>Framework marketplace</h2></div><button class=\"ghost-button\" data-go=\"marketplace\">Explore all frameworks →</button></div>\n        <div class=\"feature-band\"><div><div class=\"feature-icon\">▦</div><h3>One library. Every supported platform.</h3><p>Browse curated, version-pinned SDKs with OS-specific dependencies and approval-gated install plans. Install from the portal or ask ChatGPT to orchestrate the same policy.</p></div><button class=\"outline-button\" data-go=\"marketplace\">Browse marketplace →</button></div>\n      </section>\n      <section data-page=\"connections\" hidden><div class=\"page-heading\"><span class=\"section-kicker\">INTEGRATIONS</span><h1>Connect your workbench.</h1><p>Three integrations establish identity, private connectivity and natural-language control.</p></div>\n        <div class=\"connection-stack\">\n          <article class=\"connection-card\"><div class=\"connection-icon\">⌘</div><div class=\"connection-body\"><div class=\"connection-title\"><h2>GitHub</h2><span class=\"state-pill pending\">Not connected</span></div><p>GitHub App authorization should request only explicitly selected repositories. No personal access tokens copied into browser forms.</p><div class=\"metadata\"><span>METHOD <strong>GitHub App OAuth</strong></span><span>SCOPE <strong>Selected repositories</strong></span></div><div class=\"inline-warning\">GitHub OAuth and App installation need server credentials and persistent authorization storage. Not configured in this preview.</div><a class=\"outline-button inline-button\" href=\"https://github.com/maincreate/main-platform\" target=\"_blank\" rel=\"noopener noreferrer\">View integration project ↗</a></div></article>\n          <article class=\"connection-card\"><div class=\"connection-icon\">⌁</div><div class=\"connection-body\"><div class=\"connection-title\"><h2>Agentic tunnel</h2><span class=\"state-pill pending\">Not enrolled</span></div><p>Install a signed Main{Create} agent on a trusted computer. It connects outbound, receives scoped jobs and exposes only approved capabilities.</p><div class=\"metadata\"><span>TRANSPORT <strong>Outbound-only</strong></span><span>CONTROL <strong>Per-node capability policy</strong></span></div><div class=\"inline-warning\">Enrollment is disabled until one-time pairing, revocation and node authentication are implemented.</div><button class=\"outline-button inline-button\" data-modal=\"agent\">View deployment requirements →</button></div></article>\n          <article class=\"connection-card\"><div class=\"connection-icon\">✳</div><div class=\"connection-body\"><div class=\"connection-title\"><h2>ChatGPT MCP</h2><span class=\"state-pill pending\">Not verified</span></div><p>Add Main{Create} from ChatGPT's Plugins interface using its future authenticated HTTPS MCP endpoint. The portal will verify an authorized call, not merely a redirect.</p><div class=\"metadata\"><span>ENDPOINT <strong>Not provisioned</strong></span><span>STATUS <strong>Awaiting OAuth + handshake</strong></span></div><div class=\"inline-warning\">Current ChatGPT custom-MCP availability and write permissions depend on plan and workspace.</div><button class=\"outline-button inline-button\" data-modal=\"chatgpt\">See ChatGPT instructions →</button></div></article>\n        </div>\n      </section>\n      <section data-page=\"marketplace\" hidden><div class=\"page-heading\"><span class=\"section-kicker\">APPROVED CATALOG</span><h1>Framework marketplace.</h1><p>Declarative installation recipes. Pinned versions, platform-aware dependencies, verification checks and explicit review before changes.</p></div>\n        <div class=\"catalog-toolbar\"><label class=\"search-wrap\"><span>⌕</span><input id=\"framework-search\" type=\"search\" placeholder=\"Search frameworks, SDKs and tools\" aria-label=\"Search frameworks\"></label><select id=\"platform-filter\" aria-label=\"Filter operating system\"><option value=\"all\">All platforms</option><option value=\"linux\">Linux</option><option value=\"macos\">macOS</option><option value=\"windows\">Windows</option></select></div>\n        <div class=\"catalog-grid\" id=\"catalog-grid\" aria-live=\"polite\"><p class=\"muted\">Loading catalog…</p></div>\n        <div class=\"policy-note\"><strong>Trust model:</strong> A listed framework is not permission to execute arbitrary installation scripts. Recipes are signed or digest-pinned, host-compatible, reviewed, and installed through an authenticated agent after a plan and approval. This preview supports planning, not execution.</div>\n      </section>\n      <section data-page=\"runners\" hidden><div class=\"page-heading\"><span class=\"section-kicker\">EXECUTION FABRIC</span><h1>Your build nodes.</h1><p>Share dedicated hardware by toolchain and OS, while keeping builds and device access isolated.</p></div>\n        <div class=\"runner-grid\">\n          <article class=\"runner-card\"><div class=\"runner-row\"><span class=\"node-icon\">π</span><span class=\"state-pill pending\">Not enrolled</span></div><h3>ESP32 Builder</h3><p>Linux ARM64 · Raspberry Pi</p><div class=\"runner-spec\">ESP-IDF / LVGL / toolchains</div><div class=\"line\"></div><small>One machine can serve many trusted ESP32 repositories through organization-scoped runners.</small></article>\n          <article class=\"runner-card\"><div class=\"runner-row\"><span class=\"node-icon\">⌘</span><span class=\"state-pill pending\">Not enrolled</span></div><h3>macOS Builder</h3><p>Apple silicon or approved Mac host</p><div class=\"runner-spec\">Swift / Xcode / Apple platforms</div><div class=\"line\"></div><small>Reusable macOS build capacity with Xcode version and signing identity pinned to each workflow.</small></article>\n          <article class=\"runner-card\"><div class=\"runner-row\"><span class=\"node-icon\">⊞</span><span class=\"state-pill planned\">Planned</span></div><h3>Windows Builder</h3><p>Windows x64</p><div class=\"runner-spec\">Windows SDK / ESP-IDF / desktop</div><div class=\"line\"></div><small>Windows-specific dependencies, installers, reboots and agent privileges get separate validation.</small></article>\n        </div>\n        <div class=\"policy-note\">Existing WaymarkerOS runners are separate from this preview portal. They are not represented as online until an authenticated node inventory can verify them.</div>\n      </section>\n      <section data-page=\"activity\" hidden><div class=\"page-heading\"><span class=\"section-kicker\">AUDIT TRAIL</span><h1>Activity & jobs.</h1><p>Every installation, build, device action and artifact will have an operator, policy, job ID, revision and outcome.</p></div><div class=\"empty-state\"><span>≡</span><h3>No Main{Create} jobs yet</h3><p>After you connect an agent and authorize the MCP, planned and executed jobs will appear here with detailed status and audit links.</p><button class=\"outline-button\" data-go=\"connections\">Configure connections →</button></div></section>\n    </main>\n  </div>\n</div>\n<dialog id=\"details\"><div class=\"dialog-header\"><div><span class=\"section-kicker\" id=\"dialog-kicker\">DETAILS</span><h2 id=\"dialog-title\">Details</h2></div><button class=\"close-button\" id=\"dialog-close\" aria-label=\"Close dialog\">×</button></div><div id=\"dialog-body\"></div></dialog>\n<script src=\"/portal.js\" defer></script>\n</body></html>";
const PORTAL_CSS = ":root{color-scheme:dark;--bg:#0b1218;--panel:#111c24;--panel2:#14222c;--outline:#293944;--text:#eff6f4;--muted:#91a4ae;--mint:#b5efce;--teal:#326b5b;--amber:#ffcf7a}*{box-sizing:border-box}html{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}body{margin:0;background:var(--bg);color:var(--text);line-height:1.5}a{color:inherit;text-decoration:none}button,input,select{font:inherit}button{cursor:pointer}.shell{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:100vh}.sidebar{background:#101920;border-right:1px solid var(--outline);display:flex;flex-direction:column;padding:30px 18px;min-height:100vh}.brand{display:flex;gap:12px;align-items:center;font-size:17px;font-weight:800;letter-spacing:-.6px;padding:0 10px}.brand small{display:block;margin-top:1px;font-size:9px;letter-spacing:1.6px;font-weight:750;color:var(--muted)}.brand-mark{font-weight:900;display:flex;align-items:center;justify-content:center;width:38px;height:38px;background:var(--mint);color:#0d2822;border-radius:10px;font-size:21px}.brand-mark span{font-size:12px}.nav-caption{font-size:10px;font-weight:800;letter-spacing:1.5px;color:#6d8592;margin:61px 12px 15px}.sidebar nav{display:flex;flex-direction:column;gap:5px}.nav-link{text-align:left;color:#a6b8c0;background:transparent;border:0;border-radius:9px;padding:13px 13px;font-weight:600;font-size:13px}.nav-link:hover,.nav-link.active{background:#21382f;color:var(--mint)}.nav-icon{display:inline-block;width:28px;font-size:19px;vertical-align:middle}.side-bottom{margin-top:auto;padding:16px 8px 0}.side-bottom>a{display:block;color:#a7b8c1;font-size:12px;padding:23px 8px 0}.side-note{display:flex;align-items:center;gap:12px;background:#17232c;border:1px solid var(--outline);border-radius:11px;padding:13px 10px}.side-note strong{display:block;font-size:12px}.side-note small{font-size:10px;color:var(--muted)}.status-dot{display:inline-block;flex-shrink:0;width:9px;height:9px;border-radius:50%}.amber{background:var(--amber)}.main-shell{min-width:0}.topbar{height:75px;border-bottom:1px solid var(--outline);display:flex;justify-content:space-between;align-items:center;padding:0 55px;font-size:13px}.topbar .crumb,.slash{color:#8296a2}.slash{margin:0 14px}.top-actions{display:flex;align-items:center;gap:23px}.environment{color:#e7bc79;background:#44341e54;border:1px solid #5a452b;border-radius:6px;padding:7px 10px;letter-spacing:1px;font-size:10px;font-weight:800}.help-link{color:#b2c2ca}main{max-width:1530px;margin:auto;padding:46px 55px 100px}section[hidden]{display:none!important}.hero{background:radial-gradient(circle at 85% 40%,#18483c 0%,transparent 42%),linear-gradient(115deg,#17282b,#122129);border:1px solid #2b4943;border-radius:17px;min-height:327px;display:flex;position:relative;overflow:hidden;align-items:center;justify-content:space-between;padding:44px 48px}.hero>div:first-child{z-index:1}.eyebrow,.section-kicker{color:var(--mint);font-size:10px;letter-spacing:2px;font-weight:850}.pulse{display:inline-block;background:#b1ebc8;width:7px;height:7px;border-radius:50%;margin-right:9px;box-shadow:0 0 0 4px #b1ebc81a}.hero h1{font-size:clamp(36px,4.2vw,61px);letter-spacing:-.056em;line-height:1.09;margin:19px 0 12px}.hero h1 em{font-style:normal;color:var(--mint)}.hero p{color:#aebec5;max-width:550px;font-size:13px;line-height:1.7;margin:0 0 23px}.primary-button,.outline-button,.ghost-button,.text-action{display:inline-flex;gap:24px;align-items:center;justify-content:center;border-radius:9px;padding:10px 17px;font-size:12px;font-weight:800}.primary-button{background:var(--mint);color:#0e2821;border:1px solid var(--mint)}.primary-button:hover{background:#d7ffe5}.outline-button{border:1px solid #4d6965;background:#1c302e;color:var(--mint)}.outline-button:hover{background:#2b4841}.ghost-button{border:0;background:transparent;color:var(--mint)}.hero-art{width:320px;height:260px;position:relative;flex:none}.mesh-circle{position:absolute;top:50%;left:50%;border-radius:50%;border:1px solid #74cba74b;transform:translate(-50%,-50%)}.ring1{width:120px;height:120px}.ring2{width:205px;height:205px}.ring3{width:280px;height:280px;border-style:dashed}.hero-core{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:82px;height:82px;border-radius:22px;background:var(--mint);color:#0f3027;font-size:44px;font-weight:900;box-shadow:0 0 60px #8de2b744}.hero-core span{font-size:19px}.mesh-tag{position:absolute;color:#d0f5df;font-size:9px;letter-spacing:1.1px;font-weight:800;padding:8px 11px;border:1px solid #5f9d82;background:#17382f;border-radius:6px}.tag1{top:26px;left:15px}.tag2{right:3px;top:92px}.tag3{bottom:18px;left:42px}.section-header{display:flex;align-items:end;justify-content:space-between;margin:42px 0 17px;gap:16px}.section-header h2{font-size:24px;letter-spacing:-.04em;margin:6px 0 0}.muted{color:var(--muted);font-size:12px}.steps-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.step-card,.runner-card{background:var(--panel);border:1px solid var(--outline);border-radius:12px;padding:21px;min-width:0}.step-top,.runner-row{display:flex;justify-content:space-between;align-items:center;gap:5px}.step-number{font-size:10px;letter-spacing:1.4px;color:var(--muted);font-weight:750}.state-pill{font-size:10px;font-weight:750;white-space:nowrap;border-radius:5px;padding:5px 8px}.pending{background:#403520;color:#ffd48b}.planned{background:#243341;color:#aec5e6}.step-glyph{display:flex;align-items:center;justify-content:center;margin-top:23px;width:45px;height:45px;border-radius:10px;background:#1d3835;color:var(--mint);font-size:27px}.step-card h3,.runner-card h3{font-size:16px;margin:16px 0 7px}.step-card p,.feature-band p,.connection-body p,.runner-card p{font-size:12px;color:var(--muted);line-height:1.7}.step-card p{min-height:80px}.text-action{padding:8px 0;color:var(--mint);background:none;border:0;justify-content:start}.feature-band{display:flex;justify-content:space-between;align-items:center;gap:25px;padding:24px 29px;border-radius:12px;border:1px solid #38574b;background:linear-gradient(115deg,#152e29,#16232b)}.feature-band h3{margin:7px 0;font-size:17px}.feature-band p{max-width:580px;margin:0}.feature-icon{color:var(--mint);font-size:24px}.compact{margin-top:48px}.page-heading{margin:12px 0 29px}.page-heading h1{font-size:42px;letter-spacing:-.06em;line-height:1.1;margin:12px 0}.page-heading p{max-width:680px;font-size:14px;color:var(--muted)}.connection-stack{display:grid;gap:16px}.connection-card{display:flex;gap:22px;background:var(--panel);border:1px solid var(--outline);border-radius:14px;padding:27px}.connection-icon{display:flex;align-items:center;justify-content:center;border-radius:12px;background:#1c3833;color:var(--mint);font-size:28px;width:54px;height:54px;flex-shrink:0}.connection-body{flex:1}.connection-title{display:flex;gap:14px;align-items:center}.connection-title h2{font-size:21px;margin:0}.connection-body p{margin:9px 0 18px}.metadata{display:flex;gap:33px;flex-wrap:wrap;font-size:10px;letter-spacing:1px;color:var(--muted)}.metadata strong{display:block;font-size:12px;letter-spacing:0;color:#e4f1ed;margin-top:4px}.inline-warning{background:#3f352329;border-left:2px solid #ac8451;color:#ddc8a8;font-size:11px;margin:18px 0;padding:11px 13px}.inline-button{padding:9px 15px}.catalog-toolbar{display:flex;gap:12px;margin:25px 0}.search-wrap{flex:1;display:flex;align-items:center;gap:12px;padding:0 17px;background:var(--panel);border:1px solid var(--outline);border-radius:9px;color:var(--mint)}input{min-width:0;width:100%;color:var(--text);background:transparent;border:0;outline:0;padding:14px 0;font-size:13px}select{background:var(--panel);color:#d4e5e0;border:1px solid var(--outline);border-radius:9px;padding:0 14px;min-width:155px}.catalog-grid,.runner-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.catalog-card{background:var(--panel);border:1px solid var(--outline);border-radius:13px;padding:23px;display:flex;flex-direction:column;min-height:280px}.catalog-icon{display:flex;justify-content:center;align-items:center;width:46px;height:46px;border:1px solid #3a6959;background:#193a31;color:var(--mint);font-size:23px;border-radius:10px}.catalog-title{font-size:17px;margin:17px 0 1px}.version{font-size:11px;color:#a1bcad}.catalog-card p{font-size:12px;color:var(--muted);line-height:1.6}.platforms{display:flex;flex-wrap:wrap;gap:6px;margin:7px 0 20px}.platform{border:1px solid #385058;border-radius:5px;font-size:10px;color:#c3d7dc;padding:4px 7px}.catalog-card button{margin-top:auto;justify-content:space-between}.policy-note{background:#14232c;color:#9fb3bd;border:1px solid var(--outline);padding:18px 22px;border-radius:11px;font-size:12px;margin-top:22px;line-height:1.7}.policy-note strong{color:#e3f1ee}.runner-card{padding:26px}.node-icon{font-size:26px;color:var(--mint)}.runner-spec{font-size:12px;color:#d8eae4;margin:26px 0 13px}.line{height:1px;background:var(--outline);margin-bottom:13px}.runner-card small{color:var(--muted);line-height:1.65}.empty-state{max-width:610px;background:var(--panel);border:1px dashed #496256;border-radius:14px;text-align:center;margin:36px auto;padding:58px 30px}.empty-state>span{font-size:40px;color:var(--mint)}.empty-state h3{margin:10px 0 0}.empty-state p{font-size:13px;color:var(--muted);margin-bottom:23px}dialog{color:var(--text);background:#15232b;border:1px solid #426356;border-radius:15px;padding:29px;width:min(610px,calc(100vw - 30px));box-shadow:0 40px 100px #000a}dialog::backdrop{background:#020a0ecc}.dialog-header{display:flex;justify-content:space-between;align-items:flex-start;gap:15px}.dialog-header h2{font-size:24px;letter-spacing:-.03em;margin:6px 0 15px}.close-button{font-size:24px;color:var(--text);background:transparent;border:0}#dialog-body{color:#b6c9c7;font-size:13px;line-height:1.75}#dialog-body p{margin-top:0}#dialog-body select{width:100%;height:42px;margin:7px 0 15px}.detail-box{background:#1c3333;border:1px solid #35594e;padding:15px;border-radius:9px;margin:13px 0;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.detail-box strong{color:var(--mint)}.detail-label{display:block;margin-top:12px;color:#ecf4f1;font-weight:750}.detail-actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}.dialog-note{font-size:11px;color:#f0d6a4}.loading{text-align:center;color:var(--muted);padding:20px}@media(max-width:1160px){.hero-art{width:210px}.ring3{width:220px;height:220px}.tag2{right:-7px}.tag3{left:0}.topbar,main{padding-left:30px;padding-right:30px}.steps-grid,.catalog-grid,.runner-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.shell{display:block}.sidebar{min-height:0;padding:17px 15px;position:static}.brand{margin-bottom:12px}.nav-caption,.side-bottom{display:none}.sidebar nav{display:flex;flex-direction:row;overflow:auto;gap:4px}.nav-link{white-space:nowrap;padding:9px 12px}.nav-icon{display:none}.topbar{height:54px;padding:0 18px}.environment{display:none}.top-actions{gap:8px}.help-link{font-size:11px}main{padding:18px 15px 80px}.hero{padding:28px 22px;min-height:300px}.hero-art{display:none}.hero h1{font-size:39px}.steps-grid,.catalog-grid,.runner-grid{grid-template-columns:1fr}.step-card p{min-height:0}.feature-band{display:block}.feature-band button{margin-top:18px}.connection-card{padding:19px;gap:13px}.connection-icon{width:35px;height:35px;font-size:21px}.catalog-toolbar{flex-direction:column}.catalog-toolbar select{height:45px}.page-heading h1{font-size:34px}.section-header{align-items:start}.section-header h2{font-size:21px}}";
const PORTAL_JS = "(function(){\n\"use strict\";\nvar views=[\"overview\",\"connections\",\"marketplace\",\"runners\",\"activity\"], catalog=[];\nvar dialog=document.getElementById(\"details\");\nfunction node(tag, cls, value){var e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e}\nfunction clear(el){while(el.firstChild)el.removeChild(el.firstChild)}\nfunction show(view){if(views.indexOf(view)===-1)view=\"overview\";document.querySelectorAll(\"[data-page]\").forEach(function(el){el.hidden=el.dataset.page!==view});document.querySelectorAll(\"[data-view]\").forEach(function(el){el.classList.toggle(\"active\",el.dataset.view===view)});document.getElementById(\"view-title\").textContent=view.charAt(0).toUpperCase()+view.slice(1);if(location.hash.slice(1)!==view)history.replaceState(null,\"\",\"#\"+view);window.scrollTo(0,0)}\nfunction openDialog(title,kicker){document.getElementById(\"dialog-title\").textContent=title;document.getElementById(\"dialog-kicker\").textContent=kicker||\"DETAILS\";clear(document.getElementById(\"dialog-body\"));dialog.showModal();return document.getElementById(\"dialog-body\")}\nfunction appendText(parent,tag,cls,value){var n=node(tag,cls,value);parent.appendChild(n);return n}\nfunction infoModal(type){\n var d;\n if(type===\"agent\"){d=openDialog(\"Agent enrollment\",\"SECURE TUNNEL\");appendText(d,\"p\",\"\",\"A production agent must register using a short-lived pairing code, authenticate over an outbound connection, advertise an allowlisted capability set, and support immediate revocation.\");appendText(d,\"div\",\"detail-box\",\"Planned steps:\\n1. Choose a node OS and architecture.\\n2. Download and verify a signed agent release.\\n3. Approve a one-time pairing challenge.\\n4. Confirm heartbeat, permissions and installed toolchains.\");appendText(d,\"p\",\"dialog-note\",\"No installer or pairing code is available in this preview. Do not run unverified setup scripts.\");}\n else if(type===\"chatgpt\"){d=openDialog(\"Connect to ChatGPT\",\"MCP ONBOARDING\");appendText(d,\"p\",\"\",\"From ChatGPT on the web, open Plugins, choose Add custom MCP server (when available for your plan/workspace), enter the Main{Create} authenticated HTTPS MCP endpoint, approve the requested permissions, and test framework discovery.\");appendText(d,\"div\",\"detail-box\",\"Endpoint: not provisioned\\nAuthorization: not configured\\nVerified MCP handshakes: none\");appendText(d,\"p\",\"dialog-note\",\"Do not attempt to register this preview site as an MCP endpoint. It does not yet serve the MCP protocol.\");var a=node(\"a\",\"outline-button inline-button\",\"Open ChatGPT ↗\");a.href=\"https://chatgpt.com/\";a.target=\"_blank\";a.rel=\"noopener noreferrer\";d.appendChild(a);}\n}\nfunction card(item){\n var c=node(\"article\",\"catalog-card\"),icon=node(\"div\",\"catalog-icon\",item.icon);icon.setAttribute(\"aria-hidden\",\"true\");c.appendChild(icon);\n appendText(c,\"h3\",\"catalog-title\",item.name);appendText(c,\"span\",\"version\",\"v\"+item.version+\" · \"+item.category);\n appendText(c,\"p\",\"\",item.description);\n var platforms=node(\"div\",\"platforms\");item.targets.forEach(function(t){appendText(platforms,\"span\",\"platform\",t.os+\" · \"+t.arch)});c.appendChild(platforms);\n var b=node(\"button\",\"outline-button\",\"Plan installation →\");b.type=\"button\";b.addEventListener(\"click\",function(){planDialog(item)});c.appendChild(b);return c\n}\nfunction renderCatalog(){var q=(document.getElementById(\"framework-search\").value||\"\").trim().toLowerCase(),os=document.getElementById(\"platform-filter\").value,el=document.getElementById(\"catalog-grid\");clear(el);var selected=catalog.filter(function(x){return(x.name+\" \"+x.description+\" \"+x.category).toLowerCase().includes(q)&&(os===\"all\"||x.targets.some(function(y){return y.os===os}))});selected.forEach(function(x){el.appendChild(card(x))});if(!selected.length)appendText(el,\"p\",\"muted\",\"No catalog matches. Try another search or platform.\")}\nfunction planDialog(item){var d=openDialog(item.name+\" \"+item.version,\"INSTALLATION PLAN\"),p=node(\"p\",\"\",\"Select a target operating system and architecture. This is an API-backed dry run, not an installation.\");d.appendChild(p);\n var select=node(\"select\");select.setAttribute(\"aria-label\",\"Target platform\");item.targets.forEach(function(t){var o=node(\"option\",\"\",t.os+\" / \"+t.arch+\" — \"+t.readiness);o.value=t.os+\":\"+t.arch;select.appendChild(o)});d.appendChild(select);\n var output=node(\"div\",\"detail-box\",\"Choose a target, then generate a validated dry-run plan.\");d.appendChild(output);\n var action=node(\"button\",\"primary-button\",\"Generate plan →\");d.appendChild(action);action.addEventListener(\"click\",async function(){action.disabled=true;output.textContent=\"Checking recipe and target…\";try{var parts=select.value.split(\":\");var res=await fetch(\"/api/v1/plans\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({framework:item.id,os:parts[0],arch:parts[1]})});var data=await res.json();if(!res.ok)throw Error(data.error||\"Planning failed\");output.textContent=\"Status: \"+data.status+\"\\nPackage: \"+data.framework+\"@\"+data.version+\"\\nTarget: \"+data.target.os+\"/\"+data.target.arch+\"\\nReadiness: \"+data.target.readiness+\"\\n\\nDependencies:\\n\"+data.dependencies.map(function(x){return\"• \"+x}).join(\"\\n\")+\"\\n\\nVerification:\\n\"+data.checks.map(function(x){return\"• \"+x}).join(\"\\n\")+\"\\n\\nApproval: \"+data.approval+\"\\nExecution: \"+data.execution;}catch(e){output.textContent=\"Unable to plan: \"+e.message}finally{action.disabled=false}});\n appendText(d,\"p\",\"dialog-note\",\"Installation remains disabled until GitHub, agent identity, installer policy and an authenticated approval flow are live.\");\n}\nasync function boot(){try{var r=await fetch(\"/api/v1/catalog\",{headers:{\"Accept\":\"application/json\"}});if(!r.ok)throw Error(\"Catalog request failed\");var data=await r.json();catalog=data.frameworks||[];renderCatalog()}catch(e){document.getElementById(\"catalog-grid\").textContent=\"Catalog unavailable: \"+e.message}try{var s=await fetch(\"/api/v1/status\",{cache:\"no-store\"});if(s.ok){var obj=await s.json();var count=0;[\"github\",\"agent\",\"mcp\"].forEach(function(key){var st=obj.connections&&obj.connections[key];var el=document.getElementById(key+\"-state\");if(st&&el){el.textContent=st.label;count+=st.verified?1:0}});document.getElementById(\"step-count\").textContent=count+\" of 3 verified\";}}catch(e){document.getElementById(\"step-count\").textContent=\"Connection status unavailable\"}}\ndocument.querySelectorAll(\"[data-go]\").forEach(function(e){e.addEventListener(\"click\",function(){show(e.dataset.go)})});document.querySelectorAll(\"[data-view]\").forEach(function(e){e.addEventListener(\"click\",function(){show(e.dataset.view)})});\ndocument.querySelectorAll(\"[data-modal]\").forEach(function(e){e.addEventListener(\"click\",function(){infoModal(e.dataset.modal)})});\ndocument.getElementById(\"dialog-close\").addEventListener(\"click\",function(){dialog.close()});dialog.addEventListener(\"click\",function(e){if(e.target===dialog)dialog.close()});\ndocument.getElementById(\"framework-search\").addEventListener(\"input\",renderCatalog);document.getElementById(\"platform-filter\").addEventListener(\"change\",renderCatalog);\nwindow.addEventListener(\"hashchange\",function(){show(location.hash.slice(1))});show(location.hash.slice(1));boot();\n})();";
const CATALOG = [
  {
    "id": "esp-idf",
    "name": "ESP-IDF",
    "version": "5.5.6",
    "category": "Embedded SDK",
    "icon": "◇",
    "description": "Espressif's SDK and toolchain for ESP32 firmware, with pinned Python and compiler dependencies.",
    "targets": [
      {
        "os": "linux",
        "arch": "arm64",
        "readiness": "pilot",
        "dependencies": [
          "Git",
          "Python 3 environment",
          "ESP-IDF v5.5.6 pinned release",
          "Matching Xtensa/RISC-V toolchains"
        ],
        "checks": [
          "idf.py --version = ESP-IDF v5.5.6",
          "Target compiler responds",
          "Build a known ESP32-S3 sample"
        ]
      },
      {
        "os": "linux",
        "arch": "x64",
        "readiness": "review",
        "dependencies": [
          "Git",
          "Python 3 environment",
          "ESP-IDF v5.5.6 pinned release"
        ],
        "checks": [
          "idf.py --version",
          "Toolchain smoke build"
        ]
      },
      {
        "os": "windows",
        "arch": "x64",
        "readiness": "review",
        "dependencies": [
          "Git for Windows",
          "Python tooling",
          "ESP-IDF v5.5.6 managed installer"
        ],
        "checks": [
          "ESP-IDF environment loads in PowerShell",
          "Toolchain smoke build"
        ]
      },
      {
        "os": "macos",
        "arch": "arm64",
        "readiness": "review",
        "dependencies": [
          "Xcode Command Line Tools",
          "Python 3 environment",
          "ESP-IDF v5.5.6"
        ],
        "checks": [
          "idf.py --version",
          "Toolchain smoke build"
        ]
      }
    ]
  },
  {
    "id": "lvgl",
    "name": "LVGL",
    "version": "9.x",
    "category": "UI Framework",
    "icon": "▣",
    "description": "Embedded graphics library integrated with a compatible firmware SDK and target display driver.",
    "targets": [
      {
        "os": "linux",
        "arch": "arm64",
        "readiness": "review",
        "dependencies": [
          "Pinned ESP-IDF toolchain",
          "LVGL source pinned to a release tag/digest",
          "Validated display driver and board profile"
        ],
        "checks": [
          "Compatible LVGL version resolved",
          "Display integration compiles"
        ]
      },
      {
        "os": "windows",
        "arch": "x64",
        "readiness": "review",
        "dependencies": [
          "Supported ESP-IDF environment",
          "Pinned LVGL source",
          "Board-specific display driver"
        ],
        "checks": [
          "Example builds in approved environment"
        ]
      },
      {
        "os": "macos",
        "arch": "arm64",
        "readiness": "review",
        "dependencies": [
          "Supported ESP-IDF environment",
          "Pinned LVGL source",
          "Board-specific display driver"
        ],
        "checks": [
          "Example builds in approved environment"
        ]
      }
    ]
  },
  {
    "id": "swift",
    "name": "Swift Toolchain",
    "version": "6.1.2",
    "category": "Application SDK",
    "icon": "⌘",
    "description": "Swift compiler for native apps and utilities; Apple platform builds additionally require a compatible Xcode and signing setup.",
    "targets": [
      {
        "os": "macos",
        "arch": "arm64",
        "readiness": "pilot",
        "dependencies": [
          "Compatible macOS host",
          "Swift 6.1.2 toolchain",
          "Xcode or Command Line Tools matched to target"
        ],
        "checks": [
          "swift --version = 6.1.2",
          "Compile a minimal arm64 app",
          "Check Xcode/iOS SDK for iOS builds"
        ]
      },
      {
        "os": "linux",
        "arch": "x64",
        "readiness": "review",
        "dependencies": [
          "Linux-compatible Swift distribution",
          "Required system development libraries"
        ],
        "checks": [
          "swift --version",
          "Compile minimal program"
        ]
      },
      {
        "os": "windows",
        "arch": "x64",
        "readiness": "review",
        "dependencies": [
          "Windows Swift toolchain distribution",
          "Matching Windows SDK and C++ toolchain"
        ],
        "checks": [
          "swift --version",
          "Compile minimal program"
        ]
      }
    ]
  }
];

function respond(body, status, type, noStore) {
  return new Response(body,{status:status,headers:{
    "Content-Type":type,
    "Cache-Control":noStore?"no-store":"public, max-age=300",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"strict-origin-when-cross-origin",
    "X-Frame-Options":"DENY",
    "Permissions-Policy":"camera=(),microphone=(),geolocation=()",
    "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
  }});
}
function json(obj,status=200,noStore=true){return respond(JSON.stringify(obj),status,"application/json; charset=utf-8",noStore)}
addEventListener("fetch",event=>event.respondWith(handle(event.request)));
async function handle(request){
 const url=new URL(request.url),path=url.pathname;
 if(request.method==="GET"){
   if(path==="/"||path==="/index.html")return respond(PORTAL_HTML,200,"text/html; charset=utf-8");
   if(path==="/portal.css")return respond(PORTAL_CSS,200,"text/css; charset=utf-8");
   if(path==="/portal.js")return respond(PORTAL_JS,200,"text/javascript; charset=utf-8");
   if(path==="/healthz")return json({service:"maincreate-portal",state:"preview",healthy:true});
   if(path==="/api/v1/catalog")return json({schema_version:1,frameworks:CATALOG},200,false);
   if(path==="/api/v1/status")return json({schema_version:1,mode:"preview",connections:{
      github:{verified:false,label:"Not connected"},agent:{verified:false,label:"Not enrolled"},mcp:{verified:false,label:"Not verified"}
   },warning:"Unauthenticated preview. No tenant-scoped status, OAuth, enrollment or MCP endpoint is active."});
   if(path==="/mcp")return json({error:"MCP endpoint is not enabled",code:"NOT_CONFIGURED"},503);
 }
 if(path==="/api/v1/plans"&&request.method==="POST"){
   if(!((request.headers.get("content-type")||"").toLowerCase().startsWith("application/json")))return json({error:"JSON content type required"},415);
   if(Number(request.headers.get("content-length")||"0")>4096)return json({error:"Request too large"},413);
   let input;try{const raw=await request.text();if(raw.length>4096)return json({error:"Request too large"},413);input=JSON.parse(raw)}catch(_){return json({error:"Invalid JSON"},400)}
   if(!input||typeof input.framework!=="string"||typeof input.os!=="string"||typeof input.arch!=="string")return json({error:"framework, os and arch are required"},400);
   const framework=CATALOG.find(x=>x.id===input.framework);
   if(!framework)return json({error:"Framework not found"},404);
   const target=framework.targets.find(x=>x.os===input.os&&x.arch===input.arch);
   if(!target)return json({error:"Unsupported target combination"},422);
   return json({schema_version:1,status:"dry_run",framework:framework.name,version:framework.version,target:{os:target.os,arch:target.arch,readiness:target.readiness},dependencies:target.dependencies,checks:target.checks,approval:"Required before execution",execution:"Disabled (no authenticated agent or approved installer)"});
 }
 if(path==="/api/v1/install"||path==="/api/v1/enroll"||path.startsWith("/oauth/"))return json({error:"Integration not configured",code:"NOT_CONFIGURED"},503);
 return json({error:"Not found"},404);
}
