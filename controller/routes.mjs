import {randomBytes, createHash, timingSafeEqual, createCipheriv, createDecipheriv, createSign, scrypt} from "node:crypto";
import {promisify} from "node:util";
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync} from "node:fs";
import {join} from "node:path";

const dataDir = process.env.TT_DATA_DIR || "./.tinkertunnel-data";
const dataFile = join(dataDir, "state.json");
const masterKeyFile = join(dataDir, "master.key");
const scryptAsync = promisify(scrypt);
let bootstrapBusy = false;
const SCRYPT_PARAMS = {N:32768,r:8,p:1,maxmem:64*1024*1024};
const sessions = new Map();
const failures = new Map();
const githubDeviceFlows=new Map();
const githubClientId=()=>process.env.TT_GITHUB_CLIENT_ID||"";
function githubIdentityCurrent(g) {
  return !!g.oauthUser && (!g.oauthExpiresAt || Date.parse(g.oauthExpiresAt)>Date.now());
}
async function githubDevicePost(url,params) {
  const response=await fetch(url,{method:"POST",headers:{"accept":"application/json","content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error("GitHub authorization service unavailable");
  return response.json();
}
async function githubUser(token) {
  const headers={"accept":"application/vnd.github+json","authorization":"Bearer "+token,"user-agent":"TinkerTunnel","x-github-api-version":"2022-11-28"};
  const r=await fetch("https://api.github.com/user",{headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error("GitHub could not verify your account");
  const profile=await r.json();
  if(!Number.isSafeInteger(profile.id)||typeof profile.login!=="string")throw new Error("GitHub account response incomplete");
  let organizations=[],organizationsReadable=false;
  try {
    const o=await fetch("https://api.github.com/user/orgs?per_page=100",{headers,signal:AbortSignal.timeout(12000)});
    if(o.ok) {
      const values=await o.json();
      if(Array.isArray(values)){organizations=values.filter(x=>x&&typeof x.login==="string").map(x=>({login:x.login,id:x.id}));organizationsReadable=true;}
    }
  }catch{}
  return {user:{login:profile.login,id:profile.id},organizations,organizationsReadable};
}

function digest(s) { return createHash("sha256").update(String(s)).digest("hex"); }
function equal(a,b) { const x=Buffer.from(digest(a),"hex"), y=Buffer.from(digest(b),"hex"); return timingSafeEqual(x,y); }
function rnd() { return randomBytes(32).toString("hex"); }
function key() {
  const external=process.env.TT_MASTER_KEY || "";
  if(external) {
    if(!/^[a-f0-9]{64}$/i.test(external)) throw new Error("Invalid legacy TT_MASTER_KEY");
    return Buffer.from(external,"hex");
  }
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  try { writeFileSync(masterKeyFile,randomBytes(32),{flag:"wx",mode:0o600}); }
  catch(e){if(e.code!=="EEXIST")throw e;}
  const stored=readFileSync(masterKeyFile);
  if(stored.length!==32)throw new Error("Invalid persisted master key");
  return stored;
}
async function passwordHash(password,salt=randomBytes(16).toString("hex")) {
  const derived=await scryptAsync(password,Buffer.from(salt,"hex"),64,SCRYPT_PARAMS);
  return {algorithm:"scrypt",salt,hash:derived.toString("hex")};
}
async function verifyPassword(password,record) {
  if(!record||record.algorithm!=="scrypt"||!/^[0-9a-f]{32}$/.test(record.salt||"")||!/^[0-9a-f]{128}$/.test(record.hash||""))return false;
  const derived=await scryptAsync(password,Buffer.from(record.salt,"hex"),64,SCRYPT_PARAMS);
  return timingSafeEqual(derived,Buffer.from(record.hash,"hex"));
}
function limited(name,limit=5) {
  const now=Date.now(),attempt=failures.get(name)||{n:0,until:now+60000};
  if(now>attempt.until){attempt.n=0;attempt.until=now+60000;}
  if(attempt.n>=limit)return true;
  attempt.n++;failures.set(name,attempt);return false;
}
function sessionCookie(req,id,maxAge=28800) {
  return "ttsid="+id+"; HttpOnly; SameSite=Strict; Path=/; Max-Age="+maxAge+(req.headers.get("x-forwarded-proto")==="https"?"; Secure":"");
}
function newSession(req,username) {
  const id=rnd(),csrf=rnd();
  sessions.set(id,{username,csrf,expires:Date.now()+8*3600*1000});
  return reply({authenticated:true,username,csrf},200,{"set-cookie":sessionCookie(req,id)});
}
export function initializeFirstRun() {
  key(); // Provision durable encryption before accepting credentials; fail on unwritable storage.
  state(); // Validate persisted account configuration at startup.
}
function seal(clear) {
  const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",key(),iv);
  const enc=Buffer.concat([cipher.update(String(clear),"utf8"),cipher.final()]);
  return {iv:iv.toString("base64"),ct:enc.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
}
function unseal(data) {
  const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(data.iv,"base64"));
  decipher.setAuthTag(Buffer.from(data.tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(data.ct,"base64")),decipher.final()]).toString("utf8");
}
function state() {
  if(!existsSync(dataFile)) return {schema:1,config:{name:"TinkerTunnel",role:"all-in-one",tunnelHostname:""},github:{},runners:[],invites:[]};
  const s=JSON.parse(readFileSync(dataFile,"utf8"));
  if(s.schema!==1) throw new Error("Unsupported state schema");
  return s;
}
function save(s) {
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const tmp=join(dataDir,".state-"+process.pid+"-"+randomBytes(4).toString("hex"));
  writeFileSync(tmp,JSON.stringify(s,null,2),{mode:0o600,flag:"wx"});
  renameSync(tmp,dataFile); chmodSync(dataFile,0o600);
}
function reply(obj,status=200,extra={}) {
  return new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...extra}});
}
function deny(status,reason) {return reply({error:reason},status);}
function session(req) {
  const cookie=req.headers.get("cookie")||"";
  const id=cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith("ttsid="))?.slice(6);
  const s=id&&sessions.get(id);
  if(!s||s.expires<Date.now()){if(id)sessions.delete(id);return null;}
  return s;
}
export function hasLocalAdminSession(req) { return !!session(req); }
function sameOrigin(req) {
  const origin=req.headers.get("origin");
  if(!origin)return true; // Non-browser clients require authentication and CSRF too.
  try {return new URL(origin).host===(req.headers.get("host")||"");}catch{return false;}
}
function authorized(req,mutation=false) {
  const s=session(req);
  if(!s)return deny(401,"Admin login required");
  if(mutation && !equal(req.headers.get("x-tt-csrf")||"",s.csrf))return deny(403,"CSRF token required");
  return null;
}
async function body(req) {
  if(!(req.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))throw new Error("JSON required");
  const raw=await req.text();
  if(raw.length>32768)throw new Error("Request too large");
  const obj=JSON.parse(raw);
  if(!obj||typeof obj!=="object"||Array.isArray(obj))throw new Error("JSON object required");
  return obj;
}
function bounded(s,max=100) {return typeof s==="string"&&s.length>0&&s.length<=max?s.trim():"";}
function publicSummary() {
  const s=state();
  return {configured:!!s.admin,claimed:!!s.admin,
    encryptionReady:existsSync(masterKeyFile)||/^[0-9a-f]{64}$/i.test(process.env.TT_MASTER_KEY||""),
    name:s.config.name,role:s.config.role,
    githubVerified:!!s.github.verifiedAt,
    runners:s.runners.length,
    tunnel:"manual_configuration_required",
    mcp:"bearer_token_local_only",
    warning:"Remote ChatGPT OAuth and framework execution are not yet available"};
}
async function verifyGithub(s) {
  if(!s.github.appId||!s.github.installationId||!s.github.privateKey)throw new Error("GitHub App ID, Installation ID and private key required");
  const pem=unseal(s.github.privateKey);
  const now=Math.floor(Date.now()/1000);
  const enc=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
  const part=enc({alg:"RS256",typ:"JWT"})+"."+enc({iat:now-60,exp:now+540,iss:String(s.github.appId)});
  const signer=createSign("RSA-SHA256");signer.update(part);signer.end();
  const jwt=part+"."+signer.sign(pem).toString("base64url");
  async function gh(url,headers,method="GET") {
    const r=await fetch("https://api.github.com"+url,{method,headers:{"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28",...headers},signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error("GitHub API rejected credentials or installation: HTTP "+r.status);
    return r.json();
  }
  const app=await gh("/app",{authorization:"Bearer "+jwt});
  if(Number(app.id)!==Number(s.github.appId))throw new Error("GitHub App identity mismatch");
  const access=await gh("/app/installations/"+s.github.installationId+"/access_tokens",{authorization:"Bearer "+jwt},"POST");
  if(!access.token)throw new Error("GitHub installation token unavailable");
  const repos=await gh("/installation/repositories?per_page=100",{authorization:"Bearer "+access.token});
  if(!repos.repositories?.some(r=>r.full_name.toLowerCase()===s.github.repository.toLowerCase()))throw new Error("Configured repository not in first 100 accessible installation repositories");
  return {app:app.slug,repository:s.github.repository};
}
export async function localRoute(req) {
  const path=new URL(req.url).pathname,method=req.method;
  const privateApp=process.env.TT_REQUIRE_LOGIN!=="0";
  const htmlHeaders={"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
  if(path==="/"&&method==="GET"&&privateApp){
    if(!session(req))return new Response(null,{status:302,headers:{"location":"/setup","cache-control":"no-store"}});
    return new Response(readFileSync(new URL("../portal/dashboard.html",import.meta.url),"utf8"),{headers:htmlHeaders});
  }
  if(path==="/github"&&method==="GET"){
    if(privateApp&&!session(req))return new Response(null,{status:302,headers:{"location":"/setup","cache-control":"no-store"}});
    return new Response(readFileSync(new URL("../portal/github.html",import.meta.url),"utf8"),{headers:htmlHeaders});
  }
  if((path==="/github.js"||path==="/github.css")&&method==="GET"){
    if(privateApp&&!session(req))return deny(401,"Sign in required");
    return new Response(readFileSync(new URL("../portal"+path,import.meta.url),"utf8"),{headers:{"content-type":(path.endsWith(".js")?"text/javascript":"text/css")+"; charset=utf-8","cache-control":"no-store"}});
  }
  if((path==="/dashboard.js"||path==="/dashboard.css")&&method==="GET"){
    if(privateApp&&!session(req))return deny(401,"Sign in required");
    const type=path.endsWith(".js")?"text/javascript":"text/css";
    return new Response(readFileSync(new URL("../portal"+path,import.meta.url),"utf8"),{headers:{"content-type":type+"; charset=utf-8","cache-control":"no-store"}});
  }
  if(path==="/setup"&&method==="GET"){
    if(privateApp&&session(req))return new Response(null,{status:302,headers:{"location":"/","cache-control":"no-store"}});
    return new Response(readFileSync(new URL("../portal/setup.html",import.meta.url),"utf8"),{headers:htmlHeaders});
  }
  if(path==="/setup.js"&&method==="GET")return new Response(readFileSync(new URL("../portal/setup.js",import.meta.url),"utf8"),{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"}});
  if(path==="/setup.css"&&method==="GET")return new Response(readFileSync(new URL("../portal/setup.css",import.meta.url),"utf8"),{headers:{"content-type":"text/css; charset=utf-8","cache-control":"public, max-age=300"}});
  if(!path.startsWith("/api/local/")&&!path.startsWith("/api/agent/")&&!path.startsWith("/api/internal/")&&path!=="/api/v1/status")return null;
  if(!sameOrigin(req))return deny(403,"Origin rejected");
  try {
    if(path==="/api/local/public"&&method==="GET")return reply(publicSummary());
    if(path==="/api/v1/status"&&method==="GET") {
      const p=publicSummary();
      return reply({schema_version:1,mode:"local",connections:{
        github:{verified:p.githubVerified,label:p.githubVerified?"Verified":"Not verified"},
        agent:{verified:p.runners>0,label:p.runners>0?"Enrolled":"Not enrolled"},
        mcp:{verified:false,label:"OAuth not configured"}
      },warning:p.warning});
    }
    if(path==="/api/local/bootstrap"&&method==="POST") {
      // First visitor may create the administrator; all subsequent registrations are closed.
      if(state().admin)return deny(409,"Administrator is already configured");
      if(bootstrapBusy)return deny(409,"First-run setup is already in progress");
      const b=await body(req);
      const username=typeof b.username==="string"?b.username.trim():"";
      if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))return deny(422,"Username must be 3–40 letters, digits, periods, underscores or hyphens");
      if(typeof b.password!=="string"||b.password.length<12||b.password.length>128)return deny(422,"Password must be 12–128 characters");
      bootstrapBusy=true;
      try {
        const s=state();if(s.admin)return deny(409,"Administrator is already configured");
        s.admin={username,password:await passwordHash(b.password),createdAt:new Date().toISOString()};
        save(s);
        return newSession(req,username);
      } finally {bootstrapBusy=false;}
    }
    if(path==="/api/local/login"&&method==="POST"){
      const b=await body(req);
      const username=typeof b.username==="string"?b.username.trim():"";
      const password=typeof b.password==="string"?b.password:"";
      if(username.length>80||password.length>256)return deny(401,"Invalid credentials");
      const rateKey="login:"+username.toLowerCase();
      if(limited("login-global",100)||limited(rateKey,6))return deny(429,"Too many login attempts");
      const admin=state().admin;
      if(!admin)return deny(409,"Create the administrator account first");
      if(username!==admin.username||!(await verifyPassword(password,admin.password)))return deny(401,"Invalid credentials");
      failures.delete(rateKey);
      return newSession(req,username);
    }
    if(path==="/api/local/session"&&method==="GET") {
      const s=session(req);return reply({authenticated:!!s,username:s?.username||null,csrf:s?.csrf||null});
    }
    if(path.startsWith("/api/local/")) {
      const rejected=authorized(req,method!=="GET");
      if(rejected)return rejected;
      if(path==="/api/local/logout"&&method==="POST"){
        const id=(req.headers.get("cookie")||"").match(/ttsid=([a-f0-9]+)/)?.[1];
        if(id)sessions.delete(id);
        return reply({ok:true},200,{"set-cookie":sessionCookie(req,"",0)});
      }
      if(path==="/api/local/account/password"&&method==="POST") {
        const b=await body(req),s=state();
        if(!s.admin)return deny(409,"No administrator configured");
        if(typeof b.currentPassword!=="string"||!(await verifyPassword(b.currentPassword,s.admin.password)))return deny(401,"Current password is incorrect");
        if(typeof b.newPassword!=="string"||b.newPassword.length<12||b.newPassword.length>128)return deny(422,"New password must be 12–128 characters");
        if(b.newPassword===b.currentPassword)return deny(422,"Choose a different password");
        s.admin.password=await passwordHash(b.newPassword);
        save(s);
        sessions.clear();
        return reply({ok:true,loginRequired:true},200,{"set-cookie":sessionCookie(req,"",0)});
      }
      if(path==="/api/local/github/device/status"&&method==="GET"){
        const g=state().github,configured=/^[A-Za-z0-9._-]{8,100}$/.test(githubClientId());
        return reply({available:configured,connected:githubIdentityCurrent(g),login:g.oauthUser?.login||null,
          organizations:g.oauthOrganizations||[],organizationsReadable:!!g.oauthOrganizationsReadable,
          selectedOrganization:g.selectedOrganization||null,
          note:configured?null:"A GitHub App with device authorization must be configured by the TinkerTunnel distributor."});
      }
      if(path==="/api/local/github/device/start"&&method==="POST"){
        const clientId=githubClientId();
        if(!/^[A-Za-z0-9._-]{8,100}$/.test(clientId))return deny(503,"GitHub sign-in is not enabled for this installation");
        if(githubIdentityCurrent(state().github))return deny(409,"Disconnect the existing GitHub account first");
        if(limited("github-device-start",10))return deny(429,"Too many authorization attempts");
        const out=await githubDevicePost("https://github.com/login/device/code",{client_id:clientId,scope:"read:org"});
        if(out.error) return deny(502,"GitHub device authorization is unavailable; check GitHub App device-flow settings");
        if(typeof out.device_code!=="string"||typeof out.user_code!=="string"||out.verification_uri!=="https://github.com/login/device")return deny(502,"Unexpected GitHub authorization response");
        const interval=Math.max(5,Math.min(60,Number(out.interval)||5));
        const expires=Math.max(60,Math.min(1200,Number(out.expires_in)||900));
        githubDeviceFlows.set(session(req).csrf,{code:out.device_code,clientId,interval,expiresAt:Date.now()+expires*1000,nextAt:Date.now()+interval*1000});
        return reply({userCode:out.user_code,verificationUrl:"https://github.com/login/device",interval,expiresIn:expires});
      }
      if(path==="/api/local/github/device/poll"&&method==="POST"){
        const slot=session(req).csrf,flow=githubDeviceFlows.get(slot);
        if(!flow)return deny(409,"Start GitHub authorization first");
        const now=Date.now();
        if(now>=flow.expiresAt){githubDeviceFlows.delete(slot);return deny(410,"GitHub authorization expired");}
        if(now<flow.nextAt)return reply({state:"pending",retryAfter:Math.ceil((flow.nextAt-now)/1000)});
        flow.nextAt=now+flow.interval*1000;
        const out=await githubDevicePost("https://github.com/login/oauth/access_token",{
          client_id:flow.clientId,device_code:flow.code,grant_type:"urn:ietf:params:oauth:grant-type:device_code"
        });
        if(out.error==="authorization_pending")return reply({state:"pending",retryAfter:flow.interval});
        if(out.error==="slow_down"){flow.interval+=5;flow.nextAt=Date.now()+flow.interval*1000;return reply({state:"pending",retryAfter:flow.interval});}
        if(out.error){githubDeviceFlows.delete(slot);return deny(400,"GitHub authorization was denied, expired or disabled");}
        if(typeof out.access_token!=="string"||out.access_token.length<20)return deny(502,"GitHub did not return an access token");
        const result=await githubUser(out.access_token);
        const stored=state();
        stored.github.oauthUser=result.user;
        stored.github.oauthOrganizations=result.organizations;
        stored.github.oauthOrganizationsReadable=result.organizationsReadable;
        stored.github.selectedOrganization=null;
        stored.github.oauthToken=seal(out.access_token);
        stored.github.oauthExpiresAt=out.expires_in?new Date(Date.now()+Number(out.expires_in)*1000).toISOString():null;
        if(typeof out.refresh_token==="string")stored.github.oauthRefreshToken=seal(out.refresh_token);
        save(stored);githubDeviceFlows.delete(slot);
        return reply({state:"connected",login:result.user.login,organizations:result.organizations});
      }
      if(path==="/api/local/github/device/organization"&&method==="POST"){
        const input=await body(req),stored=state();
        const value=typeof input.organization==="string"?input.organization:"";
        if(!stored.github.oauthUser)return deny(409,"Connect your GitHub account first");
        if(!stored.github.oauthOrganizations?.some(o=>o.login===value))return deny(422,"Organization is not visible to the connected account");
        stored.github.selectedOrganization=value;
        save(stored);return reply({ok:true,organization:value,runnerAccessVerified:false});
      }
      if(path==="/api/local/github/device/disconnect"&&method==="POST"){
        const stored=state();
        delete stored.github.oauthToken;delete stored.github.oauthRefreshToken;
        delete stored.github.oauthUser;delete stored.github.oauthExpiresAt;
        delete stored.github.oauthOrganizations;delete stored.github.oauthOrganizationsReadable;
        delete stored.github.selectedOrganization;
        save(stored);githubDeviceFlows.delete(session(req).csrf);
        return reply({ok:true});
      }
      if(path==="/api/local/overview"&&method==="GET"){
        const stored=state(),current=session(req);
        return reply({
          username:current.username,csrf:current.csrf,
          workspace:{name:stored.config.name},
          github:{
            identityConnected:githubIdentityCurrent(stored.github),
            login:stored.github.oauthUser?.login||null,
            organization:githubIdentityCurrent(stored.github)?stored.github.selectedOrganization||null:null,
            integrationVerified:!!stored.github.verifiedAt
          },
          runners:{count:stored.runners.length},
          assistant:{connected:false}
        });
      }
      if(path==="/api/local/config"&&method==="GET"){
        const s=state();return reply({config:s.config,github:{appId:s.github.appId||"",installationId:s.github.installationId||"",repository:s.github.repository||"",hasPrivateKey:!!s.github.privateKey,verifiedAt:s.github.verifiedAt||null},runners:s.runners.map(r=>({id:r.id,name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen||null})),mcpConfigured:(process.env.TT_MCP_TOKEN||"").length>=32});
      }
      if(path==="/api/local/config"&&method==="POST"){
        const b=await body(req),s=state();
        if(!["all-in-one","management","gateway"].includes(b.role))return deny(422,"Invalid deployment role");
        if(!bounded(b.name,80))return deny(422,"Name must be 1-80 characters");
        if(b.tunnelHostname && !/^[a-z0-9.-]{3,253}$/i.test(b.tunnelHostname))return deny(422,"Invalid tunnel hostname");
        s.config={name:b.name.trim(),role:b.role,tunnelHostname:(b.tunnelHostname||"").toLowerCase()};
        save(s);return reply({ok:true,config:s.config});
      }
      if(path==="/api/local/github"&&method==="POST"){
        const b=await body(req),s=state();
        if(!Number.isSafeInteger(Number(b.appId))||Number(b.appId)<1||!Number.isSafeInteger(Number(b.installationId))||Number(b.installationId)<1)return deny(422,"Positive App and Installation IDs required");
        if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(b.repository||""))return deny(422,"owner/repository required");
        const changed=Number(b.appId)!==Number(s.github.appId)||Number(b.installationId)!==Number(s.github.installationId)||b.repository!==s.github.repository;
        s.github.appId=Number(b.appId);s.github.installationId=Number(b.installationId);s.github.repository=b.repository;
        if(b.privateKey){
          if(typeof b.privateKey!=="string"||b.privateKey.length>16384||!b.privateKey.includes("PRIVATE KEY"))return deny(422,"Invalid PEM key");
          s.github.privateKey=seal(b.privateKey);
        }
        if(changed||b.privateKey)s.github.verifiedAt=null;
        save(s);return reply({saved:true,verified:false,hasPrivateKey:!!s.github.privateKey});
      }
      if(path==="/api/local/github/verify"&&method==="POST"){
        const s=state();
        try {const result=await verifyGithub(s);s.github.verifiedAt=new Date().toISOString();save(s);return reply({verified:true,...result});}
        catch(e){s.github.verifiedAt=null;save(s);return deny(502,e.message);}
      }
      if(path==="/api/local/runners/invite"&&method==="POST"){
        const s=state(),token=rnd();
        s.invites=(s.invites||[]).filter(x=>x.expires>Date.now());
        s.invites.push({hash:digest(token),expires:Date.now()+10*60*1000});
        save(s);return reply({token,expiresInSeconds:600,warning:"Shown once. Do not put this token in Git or logs."});
      }
      return deny(404,"Unknown management endpoint");
    }
    if(path==="/api/agent/enroll"&&method==="POST"){
      const b=await body(req),s=state();
      const invite=(s.invites||[]).find(x=>equal(x.hash,digest(b.token||""))&&x.expires>Date.now());
      if(!invite)return deny(401,"Enrollment token invalid or expired");
      if(!bounded(b.name,64)||!["linux","macos","windows"].includes(b.os)||!["x64","arm64"].includes(b.arch))return deny(422,"Invalid agent identity");
      s.invites=s.invites.filter(x=>x!==invite);
      const token=rnd(),id=randomBytes(12).toString("hex");
      s.runners.push({id,name:b.name,os:b.os,arch:b.arch,tokenHash:digest(token),registeredAt:new Date().toISOString(),lastSeen:null});
      save(s);return reply({id,token,heartbeatPath:"/api/agent/heartbeat"});
    }
    if(path==="/api/agent/heartbeat"&&method==="POST"){
      const b=await body(req),s=state();
      const token=(req.headers.get("authorization")||"").replace(/^Bearer /i,"");
      const runner=s.runners.find(x=>x.id===b.id && equal(x.tokenHash, digest(token)));
      if(!runner)return deny(401,"Invalid runner token");
      runner.lastSeen=new Date().toISOString();save(s);return reply({ok:true,jobExecution:"disabled"});
    }
    if(path==="/api/internal/status"&&method==="GET"){
      const token=process.env.TT_SERVICE_TOKEN||"";
      if(token.length<32)return deny(503,"Internal service token not configured");
      if(!equal(req.headers.get("authorization")||"","Bearer "+token))return deny(401,"Unauthorized");
      const s=state();return reply({name:s.config.name,githubVerified:!!s.github.verifiedAt,runners:s.runners.map(r=>({name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen})),executionEnabled:false});
    }
    return deny(404,"Not found");
  } catch(e) {
    if(e instanceof SyntaxError)return deny(400,"Invalid JSON");
    if(e.message==="Request too large")return deny(413,e.message);
    if(e.message==="JSON required"||e.message==="JSON object required")return deny(400,e.message);
    console.error("Controller request error: Operation failed");
    return deny(503,"Configuration unavailable or invalid");
  }
}
