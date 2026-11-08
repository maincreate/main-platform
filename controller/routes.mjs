import {randomBytes, createHash, timingSafeEqual, createCipheriv, createDecipheriv, createSign, scrypt} from "node:crypto";
import {promisify} from "node:util";
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync} from "node:fs";
import {join} from "node:path";
import {hostDistributionRoute,adminHostRoute,agentHostRoute,removalActivity} from "./host_routes.mjs";
import {fabricCall,approveJob,claimJob,reportJob,agentAsset,fabricStats} from "./fabric.mjs";
import {reportDevices,listDevices,renameDevice,deviceOverview} from "./devices.mjs";
import {microcontrollerCatalog,compatibilityForDevice} from "./microcontrollers.mjs";
import {listProjects,syncProjects} from "./projects.mjs";
import {projectSummary,setProjectIgnored,requestRequirementRefresh} from "./project_monitor.mjs";
import {visibilityDefault,validateRepositoryRequest,createOrganizationRepository} from "./repository_creation.mjs";
import {releases,classifyBuilder,makeInstallationPlan,validateAssignment} from "./marketplace_planning.mjs";

const dataDir = process.env.TT_DATA_DIR || "./.tinkertunnel-data";
const dataFile = join(dataDir, "state.json");
const masterKeyFile = join(dataDir, "master.key");
const scryptAsync = promisify(scrypt);
let bootstrapBusy = false;
const provisioningNames=new Set();
const SCRYPT_PARAMS = {N:32768,r:8,p:1,maxmem:64*1024*1024};
const sessions = new Map();
const failures = new Map();
const githubDeviceFlows=new Map();
// Public product identity. Instances can override this for private/enterprise GitHub Apps.
const DEFAULT_GITHUB_CLIENT_ID="Iv23liAxFGcez9en0tY8";
const githubClientId=()=>process.env.TT_GITHUB_CLIENT_ID||state().github.oauthClientId||DEFAULT_GITHUB_CLIENT_ID;
const validGithubClientId=id=>/^[A-Za-z0-9._-]{8,100}$/.test(id);
function githubIdentityCurrent(g) {
  // A saved profile/organization alone is not proof of a usable authorization.
  return !!g.oauthUser && !!g.oauthToken &&
    (!g.oauthExpiresAt || Date.parse(g.oauthExpiresAt)>Date.now());
}
async function githubDevicePost(url,params) {
  const response=await fetch(url,{method:"POST",headers:{"accept":"application/json","content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error("GitHub authorization service unavailable");
  return response.json();
}
export async function githubInstallations(token) {
  const headers={"accept":"application/vnd.github+json","authorization":"Bearer "+token,
    "user-agent":"TinkerTunnel","x-github-api-version":"2022-11-28"};
  // Unlike classic OAuth tokens, GitHub App user access tokens return an empty
  // organization list from /user/orgs. Read installations of THIS app instead.
  const r=await fetch("https://api.github.com/user/installations?per_page=100",
    {headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error("Unable to read this GitHub App's installations. Check authorization and installation permissions.");
  const values=await r.json();
  if(!Array.isArray(values.installations))throw new Error("Invalid GitHub installations response");
  const seen=new Set(),organizations=[];
  for(const item of values.installations){
    if(item?.account?.type!=="Organization"||typeof item.account.login!=="string")continue;
    if(!Number.isSafeInteger(item.id)||!Number.isSafeInteger(item.account.id))continue;
    const key=item.account.id;
    if(seen.has(key))continue;
    seen.add(key);
    organizations.push({login:item.account.login,id:key,installationId:item.id});
  }
  return {organizations,installationsTotal:Number(values.total_count)||0,
    hasMoreInstallations:(Number(values.total_count)||0)>values.installations.length};
}
async function githubUser(token) {
  const headers={"accept":"application/vnd.github+json","authorization":"Bearer "+token,
    "user-agent":"TinkerTunnel","x-github-api-version":"2022-11-28"};
  const r=await fetch("https://api.github.com/user",{headers,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error("GitHub could not verify your account");
  const profile=await r.json();
  if(!Number.isSafeInteger(profile.id)||typeof profile.login!=="string")
    throw new Error("GitHub account response incomplete");
  return {user:{login:profile.login,id:profile.id},...await githubInstallations(token)};
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
let automaticProjectSync=null;
export function refreshProjectMonitoring(){
  const stored=state(),gh=stored.github||{},org=gh.selectedOrganization;
  if(!githubIdentityCurrent(gh)||!org)return;
  try{
    const inventory=listProjects(org),token=unseal(gh.oauthToken);
    requestRequirementRefresh({organization:org,accessToken:token,repositories:inventory.repositories});
    if(automaticProjectSync)return;
    if(inventory.updatedAt&&Date.now()-Date.parse(inventory.updatedAt)<60*60*1000)return;
    const selection=gh.oauthOrganizations?.find(o=>o.login===org);
    if(!Number.isSafeInteger(selection?.installationId))return;
    automaticProjectSync=syncProjects({organization:org,installationId:selection.installationId,accessToken:token})
      .then(result=>requestRequirementRefresh({organization:org,accessToken:token,repositories:result.repositories}))
      .catch(e=>console.error("Automatic project sync unavailable: "+String(e.message||"unknown").slice(0,120)))
      .finally(()=>{automaticProjectSync=null});
  }catch(e){console.error("Project monitoring refresh unavailable: "+String(e.message||"unknown").slice(0,120));}
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
  if(raw.length>85000)throw new Error("Request too large");
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
    warning:"Remote ChatGPT OAuth is not yet available. Runner execution requires explicit approval and operator opt-in."};
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

function selectedRepositoryOrganization(s){
 const g=s.github||{};
 if(!githubIdentityCurrent(g)||!g.selectedOrganization)throw Object.assign(new Error("Connect a GitHub organization first"),{status:409});
 if(!g.oauthOrganizations?.some(o=>o.login===g.selectedOrganization&&Number.isSafeInteger(o.installationId)))
   throw Object.assign(new Error("Refresh and select an authorized GitHub App organization installation"),{status:409});
 return g.selectedOrganization;
}
async function provisionRepository(input,actor){
 const stored=state(),organization=selectedRepositoryOrganization(stored);
 const request=validateRepositoryRequest(input,organization,stored.github.defaultVisibility);
 const lock=organization.toLowerCase()+"/"+request.name.toLowerCase();
 if(provisioningNames.has(lock))throw Object.assign(new Error("Repository creation is already in progress"),{status:409});
 provisioningNames.add(lock);
 try{
   const created=await createOrganizationRepository(request,unseal(stored.github.oauthToken));
   const next=state();
   next.github.repositoryAudit=(next.github.repositoryAudit||[]).slice(-99);
   next.github.repositoryAudit.push({at:new Date().toISOString(),actor,repository:created.fullName,visibility:created.visibility});
   save(next);
   return created;
 }finally{provisioningNames.delete(lock);}
}
function repositoryRequests(s){return Array.isArray(s.github?.repositoryRequests)?s.github.repositoryRequests:[];}
function requestRepositoryFromMcp(input){
 const stored=state(),org=selectedRepositoryOrganization(stored);
 const spec=validateRepositoryRequest(input,org,stored.github.defaultVisibility);
 const queued=repositoryRequests(stored).filter(r=>r.status==="pending");
 if(queued.length>=25)throw Object.assign(new Error("Too many pending repository approvals"),{status:429});
 if(queued.some(r=>r.organization.toLowerCase()===org.toLowerCase()&&r.name.toLowerCase()===spec.name.toLowerCase()))
   throw Object.assign(new Error("An approval request already exists for this repository"),{status:409});
 const request={id:randomBytes(16).toString("hex"),...spec,status:"pending",source:"mcp",requestedAt:new Date().toISOString()};
 stored.github.repositoryRequests=[...repositoryRequests(stored).slice(-99),request];
 save(stored);
 return {requestId:request.id,repository:spec.organization+"/"+spec.name,
   visibility:spec.visibility,status:"awaiting_admin_approval",
   instruction:"Open TinkerTunnel > Settings > GitHub to approve. An MCP client cannot approve its own request."};
}

function applyApprovalPreference(tool,args,context){
  const result=fabricCall(tool,args,context);
  // No device flashing or arbitrary shell capability can inherit automatic approval.
  if(tool==="tt_execute"&&state().approvalSettings?.buildApproval==="automatic"&&
      result?.job?.status==="awaiting_approval"&&result.job.capability==="firmware.esp_idf.build"){
    return {...result,job:approveJob(result.job.id,"approve").job,requires_approval:false,notice:"Approved automatically under the saved firmware build policy."};
  }
  return result;
}
function githubOnboardingReady(g){
 return githubIdentityCurrent(g)&&typeof g.selectedOrganization==="string"&&g.selectedOrganization.length>0&&
   Array.isArray(g.oauthOrganizations)&&g.oauthOrganizations.some(o=>o.login===g.selectedOrganization);
}
export async function localRoute(req) {
  const path=new URL(req.url).pathname,method=req.method;
  const privateApp=process.env.TT_REQUIRE_LOGIN!=="0";
  const htmlHeaders={"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https://github.com https://avatars.githubusercontent.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
  const distributedHostAsset=hostDistributionRoute(req);if(distributedHostAsset)return distributedHostAsset;
  if(path==="/"&&method==="GET"&&privateApp){
    if(!session(req))return new Response(null,{status:302,headers:{"location":"/setup","cache-control":"no-store"}});
    if(!githubOnboardingReady(state().github||{}))return new Response(null,{status:302,headers:{"location":"/github","cache-control":"no-store"}});
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
  if((path==="/settings"||path==="/devices"||path==="/projects"||path==="/builders"||path==="/marketplace")&&method==="GET"){
    if(privateApp&&!session(req))return new Response(null,{status:302,headers:{"location":"/setup","cache-control":"no-store"}});
    return new Response(readFileSync(new URL("../portal"+path+".html",import.meta.url),"utf8"),{headers:htmlHeaders});
  }
  if(["/settings.js","/devices.js","/projects.js","/builders.js","/marketplace.js","/actions.js","/workspace.css","/builder-actions.css","/activity.css","/marketplace-planning.css"].includes(path)&&method==="GET"){
    if(privateApp&&!session(req))return deny(401,"Sign in required");
    return new Response(readFileSync(new URL("../portal"+path,import.meta.url),"utf8"),{headers:{
      "content-type":(path.endsWith(".css")?"text/css":"text/javascript")+"; charset=utf-8","cache-control":"no-store"}});
  }
  if(path==="/jobs"&&method==="GET"){
    if(privateApp&&!session(req))return new Response(null,{status:302,headers:{"location":"/setup","cache-control":"no-store"}});
    return new Response(readFileSync(new URL("../portal/jobs.html",import.meta.url),"utf8"),{headers:htmlHeaders});
  }
  if((path==="/jobs.js"||path==="/jobs.css")&&method==="GET"){
    if(privateApp&&!session(req))return deny(401,"Sign in required");
    return new Response(readFileSync(new URL("../portal"+path,import.meta.url),"utf8"),{headers:{"content-type":(path.endsWith(".js")?"text/javascript":"text/css")+"; charset=utf-8","cache-control":"no-store"}});
  }
  if(path==="/topology"&&method==="GET"){
    if(privateApp&&!session(req))return new Response(null,{status:302,headers:{"location":"/setup","cache-control":"no-store"}});
    return new Response(readFileSync(new URL("../portal/topology.html",import.meta.url),"utf8"),{headers:htmlHeaders});
  }
  if(path==="/topology.js"&&method==="GET"){
    if(privateApp&&!session(req))return deny(401,"Sign in required");
    return new Response(readFileSync(new URL("../portal/topology.js",import.meta.url),"utf8"),{headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"}});
  }
  if((path==="/dashboard.js"||path==="/dashboard.css")&&method==="GET"){
    if(privateApp&&!session(req))return deny(401,"Sign in required");
    const type=path.endsWith(".js")?"text/javascript":"text/css";
    return new Response(readFileSync(new URL("../portal"+path,import.meta.url),"utf8"),{headers:{"content-type":type+"; charset=utf-8","cache-control":"no-store"}});
  }
  if(path==="/setup"&&method==="GET"){
    if(privateApp&&session(req))return new Response(null,{status:302,headers:{"location":githubOnboardingReady(state().github||{})?"/":"/github","cache-control":"no-store"}});
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
       const hostResponse=await adminHostRoute(req,{state,save,body,reply,deny,rnd,digest,session,seal,unseal,githubIdentityCurrent,limited,verifyPassword});
       if(hostResponse)return hostResponse;
      if(path==="/api/local/marketplace/releases"&&method==="GET")
        return reply({families:[...new Set(releases().map(r=>r.family))],releases:releases()});
      if(path==="/api/local/marketplace/plans"&&method==="GET")
        return reply({plans:(state().marketplacePlans||[]).slice(-30).reverse()});
      if(path==="/api/local/marketplace/plan"&&method==="POST"){
        try{
          const input=await body(req),s=state();
          const plan=makeInstallationPlan(input,s.runners,session(req).username);
          s.marketplacePlans=[...(s.marketplacePlans||[]).slice(-99),plan];save(s);
          return reply({plan},201);
        }catch(e){return deny(e.status||422,e.message)}
      }
      if(path==="/api/local/builders/assignment"&&method==="POST"){
        try{
          const input=await body(req);
          if(typeof input.builderId!=="string")return deny(422,"Builder ID required");
          const metadata=validateAssignment(input.assignment),s=state();
          const host=s.runners.find(r=>r.id===input.builderId);
          if(!host)return deny(404,"Builder not found");
          host.assignment=metadata;save(s);return reply({builderId:host.id,assignment:metadata});
        }catch(e){return deny(e.status||422,e.message)}
      }
      if(path==="/api/local/logout"&&method==="POST"){
        const id=(req.headers.get("cookie")||"").match(/ttsid=([a-f0-9]+)/)?.[1];
        if(id)sessions.delete(id);
        return reply({ok:true},200,{"set-cookie":sessionCookie(req,"",0)});
      }
      if(path==="/api/local/approval-settings"&&method==="GET"){
        const settings=state().approvalSettings||{};
        return reply({buildApproval:settings.buildApproval==="automatic"?"automatic":"review",
          flashApproval:"always",autoFlashAvailable:false,
          note:"GitHub Actions workflow triggers operate independently. These settings govern only TinkerTunnel-created jobs; device flashing always requires separate approval."});
      }
      if(path==="/api/local/approval-settings"&&method==="POST"){
        const b=await body(req);
        if(!["review","automatic"].includes(b.buildApproval)||b.flashApproval!=="always")
          return deny(422,"Choose an available build approval mode; firmware flashing always requires approval");
        const stored=state();stored.approvalSettings={buildApproval:b.buildApproval,flashApproval:"always"};
        save(stored);return reply({buildApproval:b.buildApproval,flashApproval:"always"});
      }
      if(path==="/api/local/installation/reset"&&method==="POST"){
        const b=await body(req),stored=state();
        if(limited("installation-reset:"+session(req).username,4))return deny(429,"Too many reset attempts");
        if(!stored.admin)return deny(409,"No administrator configured");
        if(b.confirm!=="RESET TINKERTUNNEL")return deny(422,"Enter RESET TINKERTUNNEL to confirm");
        if(typeof b.password!=="string"||!(await verifyPassword(b.password,stored.admin.password)))
          return deny(401,"Administrator password is incorrect");
        const running=fabricCall("tt_jobs",{action:"list"}).jobs.some(j=>j.status==="running");
        if(running)return deny(409,"Stop active local jobs before resetting the installation");
        // Preserve a private on-disk recovery snapshot. External GitHub repos, host agents
        // and hosting environment variables are never modified.
        const backupDir=join(dataDir,"reset-backups","reset-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomBytes(4).toString("hex"));
        mkdirSync(backupDir,{recursive:true,mode:0o700});
        const moved=[];
        try{
          for(const name of ["state.json","master.key","fabric.json","devices.json","projects.json","assets"]){
            const from=join(dataDir,name),to=join(backupDir,name);
            if(existsSync(from)){renameSync(from,to);moved.push(name);}
          }
        }catch(e){
          for(const name of moved.reverse())renameSync(join(backupDir,name),join(dataDir,name));
          return deny(503,"Reset failed before completion; original data restored");
        }
        sessions.clear();githubDeviceFlows.clear();
        return reply({reset:true,loginRequired:true,backup:"reset-backups/"+backupDir.split("/").pop(),
          note:"Old state retained in a local private recovery snapshot; external GitHub repositories and environment settings were not changed."},
          200,{"set-cookie":sessionCookie(req,"",0)});
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
        const g=state().github,configured=validGithubClientId(githubClientId());
        return reply({available:configured,connected:githubIdentityCurrent(g),
          login:githubIdentityCurrent(g)?g.oauthUser.login:null,
          clientId:githubClientId(),configuredByEnvironment:!!process.env.TT_GITHUB_CLIENT_ID,
          usingDefaultApp:!process.env.TT_GITHUB_CLIENT_ID&&!g.oauthClientId,
          organizations:g.oauthOrganizations||[],organizationsReadable:!!g.oauthOrganizationsReadable,
          selectedOrganization:githubIdentityCurrent(g)?g.selectedOrganization||null:null,
          hostedRunnerPolicyConfirmation:g.hostedRunnerPolicyConfirmation&&g.hostedRunnerPolicyConfirmation.organization===g.selectedOrganization?
            {organization:g.selectedOrganization,confirmedAt:g.hostedRunnerPolicyConfirmation.confirmedAt,
             source:"operator_confirmation_not_github_verified"}:null,
          installationsTotal:g.oauthInstallationsTotal||0,
          hasMoreInstallations:!!g.oauthHasMoreInstallations,
          note:configured?null:"Enter the public Client ID of your GitHub App to enable authorization."});
      }
      if(path==="/api/local/github/device/config"&&method==="POST"){
        if(process.env.TT_GITHUB_CLIENT_ID)return deny(409,"GitHub App Client ID is managed by the hosting environment");
        if(githubIdentityCurrent(state().github))return deny(409,"Disconnect GitHub before changing its application");
        const input=await body(req),clientId=typeof input.clientId==="string"?input.clientId.trim():"";
        if(!validGithubClientId(clientId))return deny(422,"Enter a valid GitHub App Client ID");
        const stored=state();
        stored.github.oauthClientId=clientId;
        save(stored);
        return reply({available:true,configured:true});
      }
      if(path==="/api/local/github/device/start"&&method==="POST"){
        const clientId=githubClientId();
        if(!validGithubClientId(clientId))return deny(503,"Configure the GitHub App Client ID first");
        if(githubIdentityCurrent(state().github))return deny(409,"Disconnect the existing GitHub account first");
        if(limited("github-device-start",10))return deny(429,"Too many authorization attempts");
        const out=await githubDevicePost("https://github.com/login/device/code",{client_id:clientId});
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
        stored.github.oauthOrganizationsReadable=true;
        stored.github.oauthInstallationsTotal=result.installationsTotal;
        stored.github.oauthHasMoreInstallations=result.hasMoreInstallations;
        stored.github.selectedOrganization=null;
        stored.github.oauthToken=seal(out.access_token);
        stored.github.oauthExpiresAt=out.expires_in?new Date(Date.now()+Number(out.expires_in)*1000).toISOString():null;
        if(typeof out.refresh_token==="string")stored.github.oauthRefreshToken=seal(out.refresh_token);
        else delete stored.github.oauthRefreshToken;
        save(stored);githubDeviceFlows.delete(slot);
        return reply({state:"connected",login:result.user.login,organizations:result.organizations});
      }
      if(path==="/api/local/github/device/installations/refresh"&&method==="POST"){
        const stored=state();
        if(!githubIdentityCurrent(stored.github)||!stored.github.oauthToken)
          return deny(409,"Connect or reconnect your GitHub account first");
        const result=await githubInstallations(unseal(stored.github.oauthToken));
        stored.github.oauthOrganizations=result.organizations;
        stored.github.oauthOrganizationsReadable=true;
        stored.github.oauthInstallationsTotal=result.installationsTotal;
        stored.github.oauthHasMoreInstallations=result.hasMoreInstallations;
        if(!result.organizations.some(o=>o.login===stored.github.selectedOrganization))
          stored.github.selectedOrganization=null;
        save(stored);
        return reply({organizations:result.organizations,installationsTotal:result.installationsTotal,
          hasMoreInstallations:result.hasMoreInstallations});
      }
      if(path==="/api/local/github/device/organization"&&method==="POST"){
        const input=await body(req),stored=state();
        const value=typeof input.organization==="string"?input.organization:"";
        // GitHub does not expose a supported documented API for the Standard
        // hosted runners org-level switch. We must not claim to verify or change it.
        if(input.standardHostedRunnersDisabledConfirmed!==true)
          return deny(422,"Review the organization's GitHub Actions settings and confirm that standard hosted runners are disabled.");
        if(!githubIdentityCurrent(stored.github))return deny(409,"Connect your GitHub account first");
        if(!stored.github.oauthOrganizations?.some(o=>o.login===value))return deny(422,"Organization is not visible to the connected account");
        const org=stored.github.oauthOrganizations.find(o=>o.login===value);
        if(!Number.isSafeInteger(org.installationId))return deny(409,"Install the GitHub App in this organization, then refresh organizations");
        let synced;
        try{
          synced=await syncProjects({organization:value,installationId:org.installationId,
            accessToken:unseal(stored.github.oauthToken)});
        }catch(e){return deny(e.status||502,"Could not sync repositories for "+value+": "+(e.message||"GitHub unavailable")+". Retry organization selection.");}
        const current=state();
        if(!githubIdentityCurrent(current.github))return deny(409,"GitHub authorization changed. Reconnect.");
        current.github.selectedOrganization=value;
        current.github.hostedRunnerPolicyConfirmation={
          organization:value,confirmedAt:new Date().toISOString(),
          confirmedBy:session(req).username,source:"operator_confirmation_not_github_verified"
        };
        save(current);
        return reply({ok:true,organization:value,runnerAccessVerified:false,
          standardHostedRunnersPolicy:"operator_confirmed_not_github_verified",
          repositoriesSynced:synced.repositories.length,syncedAt:synced.updatedAt});
      }
      if(path==="/api/local/github/device/disconnect"&&method==="POST"){
        const stored=state();
        delete stored.github.oauthToken;delete stored.github.oauthRefreshToken;
        delete stored.github.oauthUser;delete stored.github.oauthExpiresAt;
        delete stored.github.oauthOrganizations;delete stored.github.oauthOrganizationsReadable;
        delete stored.github.oauthInstallationsTotal;delete stored.github.oauthHasMoreInstallations;
        delete stored.github.selectedOrganization;
        delete stored.github.hostedRunnerPolicyConfirmation;
        save(stored);githubDeviceFlows.delete(session(req).csrf);
        return reply({ok:true});
      }
      if(path==="/api/local/github/repository/preferences"&&method==="GET"){
        const g=state().github||{};
        return reply({defaultVisibility:visibilityDefault(g.defaultVisibility),
          organization:githubIdentityCurrent(g)?g.selectedOrganization||null:null,
          requests:repositoryRequests({github:g}).filter(r=>["pending","creating","failed","created","rejected"].includes(r.status)).slice(-40).reverse().map(r=>({
            id:r.id,name:r.name,description:r.description,organization:r.organization,
            visibility:r.visibility,status:r.status,source:r.source,requestedAt:r.requestedAt,
            result:r.result||null
          }))});
      }
      if(path==="/api/local/github/repository/preferences"&&method==="POST"){
        const input=await body(req);
        if(!["private","public"].includes(input.defaultVisibility))return deny(422,"Default visibility must be private or public");
        const stored=state();stored.github.defaultVisibility=input.defaultVisibility;
        save(stored);return reply({defaultVisibility:input.defaultVisibility});
      }
      if(path==="/api/local/github/repository/create"&&method==="POST"){
        const input=await body(req);
        if(limited("repository-create:"+session(req).username,12))return deny(429,"Too many repository creation requests");
        try{return reply({repository:await provisionRepository(input,"portal:"+session(req).username)},201);}
        catch(e){return deny(e.status||502,e.message||"Repository creation failed");}
      }
      if(path==="/api/local/github/repository/requests/decision"&&method==="POST"){
        const input=await body(req),id=typeof input.requestId==="string"?input.requestId:"";
        if(!/^[a-f0-9]{32}$/.test(id)||!["approve","reject"].includes(input.decision))
          return deny(422,"Valid requestId and decision required");
        const stored=state(),requested=repositoryRequests(stored).find(r=>r.id===id);
        if(!requested)return deny(404,"Repository approval request not found");
        if(requested.status!=="pending")return deny(409,"Repository request already handled");
        if(input.organization!==requested.organization||input.name!==requested.name||input.visibility!==requested.visibility)
          return deny(422,"Approval details do not match the exact proposed repository");
        if(input.decision==="reject"){
          requested.status="rejected";requested.decidedAt=new Date().toISOString();
          requested.decidedBy=session(req).username;save(stored);return reply({status:"rejected",requestId:id});
        }
        try{if(selectedRepositoryOrganization(stored)!==requested.organization)
          return deny(409,"Connected organization changed; reconnect to the requested organization");}
        catch(e){return deny(e.status||409,e.message);}
        requested.status="creating";requested.decidedAt=new Date().toISOString();
        requested.decidedBy=session(req).username;save(stored);
        try{
          const repository=await provisionRepository(requested,"approved-mcp:"+session(req).username);
          const next=state(),record=repositoryRequests(next).find(r=>r.id===id);
          if(record){record.status="created";record.result=repository;save(next);}
          return reply({status:"created",requestId:id,repository},201);
        }catch(e){
          const next=state(),record=repositoryRequests(next).find(r=>r.id===id);
          if(record){record.status="failed";save(next);}
          return deny(e.status||502,e.message||"GitHub repository creation failed");
        }
      }
      if(path==="/api/local/projects"&&method==="GET"){
        const stored=state(),gh=stored.github,org=githubIdentityCurrent(gh)?gh.selectedOrganization:null;
        try{
          const jobs=fabricCall("tt_jobs",{action:"list"}).jobs;
          const inventory=listProjects(org,jobs);
          if(org&&githubIdentityCurrent(gh))requestRequirementRefresh({organization:org,
            accessToken:unseal(gh.oauthToken),repositories:inventory.repositories});
          return reply({...inventory,...projectSummary(inventory.repositories,stored.runners)});
        }catch(e){return deny(e.status||503,e.message);}
      }
      if(path==="/api/local/projects/ignore"&&method==="POST"){
        const input=await body(req),stored=state(),org=githubIdentityCurrent(stored.github)?stored.github.selectedOrganization:null;
        if(!org)return deny(409,"Connect GitHub first");
        if(typeof input.fullName!=="string"||typeof input.ignored!=="boolean"||
          !listProjects(org).repositories.some(r=>r.fullName===input.fullName))
          return deny(422,"Choose a repository from the selected GitHub organization");
        try{return reply(setProjectIgnored(input.fullName,input.ignored));}
        catch(e){return deny(422,e.message);}
      }
      if(path==="/api/local/projects/sync"&&method==="POST"){
        const gh=state().github;
        if(!githubIdentityCurrent(gh)||!gh.selectedOrganization)return deny(409,"Connect a GitHub organization first");
        const match=gh.oauthOrganizations?.find(o=>o.login===gh.selectedOrganization);
        if(!match?.installationId)return deny(409,"GitHub App installation not selected");
        try{
          const accessToken=unseal(gh.oauthToken);
          const result=await syncProjects({organization:gh.selectedOrganization,
            installationId:match.installationId,accessToken});
          requestRequirementRefresh({organization:gh.selectedOrganization,accessToken,repositories:result.repositories});
          return reply(result);
        }catch(e){return deny(e.status||502,e.message);}
      }
      if(path==="/api/local/actions/runs"&&method==="GET"){
        const s=state(),gh=s.github||{};
        if(!githubIdentityCurrent(gh)||!gh.selectedOrganization)
          return reply({organization:gh.selectedOrganization||null,runs:[],connected:false,message:"Connect a GitHub organization in Settings."});
        const projects=listProjects(gh.selectedOrganization);
        if(!projects.repositories.length)
          return reply({organization:gh.selectedOrganization,runs:[],connected:true,message:"Sync repositories in Projects to see GitHub Actions runs."});
        const headers={"accept":"application/vnd.github+json",
          "authorization":"Bearer "+unseal(gh.oauthToken),
          "x-github-api-version":"2022-11-28","user-agent":"TinkerTunnel"};
        const repos=projects.repositories.filter(r=>!r.archived).slice(0,20),runs=[],errors=[];
        let next=0;
        async function worker(){
          while(next<repos.length){
            const repo=repos[next++];
            const name=repo.fullName.split("/");
            if(name.length!==2||name[0]!==gh.selectedOrganization)continue;
            try{
              const url="https://api.github.com/repos/"+name.map(encodeURIComponent).join("/")+"/actions/runs?per_page=6";
              const response=await fetch(url,{headers,signal:AbortSignal.timeout(9000)});
              if(!response.ok){errors.push(repo.fullName+" (HTTP "+response.status+")");continue;}
              const result=await response.json();
              for(const run of Array.isArray(result.workflow_runs)?result.workflow_runs:[]){
                if(!Number.isSafeInteger(run.id)||typeof run.html_url!=="string"||
                  !run.html_url.startsWith("https://github.com/"))continue;
                runs.push({id:run.id,repository:repo.fullName,name:String(run.name||"Workflow").slice(0,160),
                  title:String(run.display_title||"").slice(0,180),status:run.status||"unknown",
                  conclusion:run.conclusion||null,created_at:run.created_at||null,
                  branch:run.head_branch||null,sha:run.head_sha||null,url:run.html_url,
                  run_number:run.run_number||null});
              }
            }catch(e){errors.push(repo.fullName+" (request unavailable)");}
          }
        }
        await Promise.all(Array.from({length:Math.min(4,repos.length)},()=>worker()));
        runs.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
        return reply({organization:gh.selectedOrganization,connected:true,runs:runs.slice(0,50),
          repositoriesScanned:repos.length,partial:errors.length>0,
          message:errors.length?"Some workflow histories could not be read; check GitHub App Actions read permissions.":null});
      }
      if(path==="/api/local/microcontrollers"&&method==="GET")return reply(microcontrollerCatalog());
      if(path==="/api/local/devices"&&method==="GET"){
        try{
         const result=listDevices({mode:new URL(req.url).searchParams.get("mode")||"visible"});
         return reply({...result,devices:result.devices.map(device=>({
          ...device,compatibility:compatibilityForDevice(device)
         }))});
        }
        catch(e){return deny(e.status||503,e.message);}
      }
      if(path==="/api/local/devices/label"&&method==="POST"){
        const b=await body(req);
        try{return reply({device:renameDevice(b.device_id,b.label)});}
        catch(e){return deny(e.status||422,e.message);}
      }
      if(path==="/api/local/activity"&&method==="GET"){
        const range=new URL(req.url).searchParams.get("range")||"7d";
        if(!["24h","7d","30d"].includes(range))return deny(422,"Unsupported activity range");
        // This is the currently retained local job ledger, not GitHub Actions history.
        const jobs=fabricCall("tt_jobs",{action:"list"}).jobs;
        const events=jobs.flatMap(job=>{
          const timestamp=job.started_at||job.created_at;
          const time=Date.parse(timestamp||"");
          if(!Number.isFinite(time))return [];
          const category=/\.build$|build/i.test(job.capability||"")?"build":"job";
          return [{id:job.id,type:category,source:"local",title:job.capability||"Job",
            builderId:job.runner_id||null,status:job.status||"unknown",
            time:new Date(time).toISOString(),url:"/jobs?job="+encodeURIComponent(job.id)}];
        });
        const now=Date.now(),span={"24h":86400000,"7d":604800000,"30d":2592000000}[range];
        return reply({range,generatedAt:new Date(now).toISOString(),retainedJobLimit:50,
          coverage:{localJobs:true,githubActions:false,deployments:false,flashes:false,
            note:"Local jobs only. GitHub Actions, deployments and device flashes are not yet recorded in this timeline."},
          events:events.filter(e=>Date.parse(e.time)>=now-span&&Date.parse(e.time)<=now)
            .sort((a,b)=>a.time.localeCompare(b.time))});
      }
      if(path==="/api/local/overview"&&method==="GET"){
        const stored=state(),current=session(req);
        return reply({
          username:current.username,csrf:current.csrf,
          workspace:{name:stored.config.name==="TinkerTunnel Local"?"TinkerTunnel":stored.config.name},
          github:{
            identityConnected:githubIdentityCurrent(stored.github),
            authorizationExpired:!!stored.github.oauthUser&&!githubIdentityCurrent(stored.github),
            login:stored.github.oauthUser?.login||null,
            organization:githubIdentityCurrent(stored.github)?stored.github.selectedOrganization||null:null,
            savedOrganization:stored.github.selectedOrganization||null,
            integrationVerified:!!stored.github.verifiedAt
          },
          runners:{
            count:stored.runners.length,
            items:stored.runners.slice(0,24).map(r=>({
              id:r.id,name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen||null,
              labels:r.labels||["tt-"+r.os,"tt-"+r.arch],packages:r.packages||[],
              githubRunnerName:r.githubRunnerName||null,managedHost:r.managedHost||null,
              software:{
               version:r.hostVersion||null,
               expectedVersion:"0.6.0",
               upToDate:!!r.hostVersion&&r.hostVersion==="0.6.0",
               updateAvailable:!!r.hostVersion&&r.hostVersion.split(".").length===3&&r.hostVersion.split(".").every(v=>v!==""&&String(Number(v))===v)&&
                r.hostVersion.split(".").map(Number).some((n,i,a)=>{
                 const expected=[0,6,0];return n!==expected[i]&&a.slice(0,i).every((v,j)=>v===expected[j])&&n<expected[i];
                }),
               error:null
              },
              upgrade:r.upgrade||null,
              decommission:r.decommission?{phase:r.decommission.phase,error:r.decommission.error||null,...removalActivity(r,stored.hostActions||[])}:null
            })),
            truncated:stored.runners.length>24,
            executionEnabled:process.env.TT_ENABLE_FABRIC_EXECUTION==="1"
          },
          devices:{...deviceOverview(),items:listDevices({mode:"visible"}).devices.slice(0,12)},
          projects:(()=>{const gh=stored.github,org=githubIdentityCurrent(gh)?gh.selectedOrganization:null;
             const d=listProjects(org),monitor=projectSummary(d.repositories,stored.runners);
             return {count:d.repositories.length,updatedAt:d.updatedAt,organization:d.organization,
               missingBuilders:monitor.alerts,unclassified:monitor.unknown};})(),
          jobs:(()=>{const j=fabricCall("tt_jobs",{action:"list"}).jobs;
            return {count:j.length,running:j.filter(x=>x.status==="running").length,
              pending:j.filter(x=>x.status==="awaiting_approval").length,
              failed:j.filter(x=>x.status==="failed").length,
              completed:j.filter(x=>x.status==="completed").length,
              recent:j.slice(0,6)};})(),
          assistant:{connected:false},
          topology:{
            secureConnectionVerified:false,
            remoteMcpVerified:false,
            toolkitsDiscovered:false
          }
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
      if(path==="/api/local/fabric"&&method==="POST"){
        const b=await body(req),s=state();
        const ctx={workspace:{name:s.config.name,githubOrganization:githubIdentityCurrent(s.github)?s.github.selectedOrganization:null},
          runners:s.runners.map(r=>({id:r.id,name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen})),
          devices:listDevices({mode:"visible"}).devices};
        if(typeof b.tool!=="string")return deny(422,"Fabric tool required");
        try{return reply(applyApprovalPreference(b.tool,b.arguments||{},ctx));}
        catch(e){return deny(e.status||422,e.message);}
      }
      if(path==="/api/local/jobs/approval"&&method==="POST"){
        const b=await body(req);
        if(typeof b.job_id!=="string")return deny(422,"job_id required");
        try{return reply(approveJob(b.job_id,b.decision));}
        catch(e){return deny(e.status||422,e.message);}
      }

      if(path==="/api/local/builders/github-runners"&&method==="GET"){
        const gh=state().github,org=gh.selectedOrganization;
        if(!githubIdentityCurrent(gh)||!org)return deny(409,"Select a GitHub organization");
        try{
          const headers={authorization:"Bearer "+unseal(gh.oauthToken),accept:"application/vnd.github+json",
            "user-agent":"TinkerTunnel","x-github-api-version":"2022-11-28"};
          const prefix="https://api.github.com/orgs/"+encodeURIComponent(org)+"/actions/runners";
          const response=await fetch(prefix+"?per_page=100",{headers,signal:AbortSignal.timeout(15000)});
          if(!response.ok)return deny(response.status===403?403:502,"Unable to list organization runners; check Self-hosted runners: read permission");
          const data=await response.json();
          // The organization download list reflects GitHub's rollout for this installation,
          // unlike the globally newest public release, which might not be available yet.
          const available=new Map();
          try{
            const versions=await fetch(prefix+"/downloads",{headers,signal:AbortSignal.timeout(10000)});
            if(versions.ok){
              const apps=await versions.json();
              if(Array.isArray(apps))for(const app of apps){
                const os=String(app.os||"").toLowerCase(),arch=String(app.architecture||"").toLowerCase();
                const match=/-(\d+\.\d+\.\d+)\.(?:tar\.gz|zip)$/.exec(String(app.filename||""));
                if(match&&["linux","osx","win"].includes(os)&&["arm64","x64"].includes(arch))
                  available.set(os+"/"+arch,match[1]);
              }
            }
          }catch{/* Installed versions still render if the download catalog is unavailable. */}
          const compare=(a,b)=>{
            if(!a||!b)return false;
            const x=a.split(".").map(Number),y=b.split(".").map(Number);
            return x.some((n,i)=>n!==y[i]&&x.slice(0,i).every((m,j)=>m===y[j])&&n<y[i]);
          };
          return reply({organization:org,runners:(data.runners||[]).map(r=>{
            const labels=(r.labels||[]).map(l=>({name:l.name,type:l.type}));
            const arch=labels.some(l=>l.name.toLowerCase()==="arm64")?"arm64":
              labels.some(l=>l.name.toLowerCase()==="x64")?"x64":null;
            const os=String(r.os||"").toLowerCase();
            const downloadOs=os==="macos"?"osx":os==="windows"?"win":os;
            const version=/^\d+\.\d+\.\d+$/.test(String(r.version||""))?r.version:null;
            const availableVersion=arch?available.get(downloadOs+"/"+arch)||null:null;
            return {id:r.id,name:r.name,os:r.os,status:r.status,busy:r.busy,version,availableVersion,
              updateAvailable:compare(version,availableVersion),labels};
          })});
        }catch{return deny(502,"GitHub runners are temporarily unavailable");}
      }
      if(path==="/api/local/builders/github-runners/labels"&&method==="POST"){
        const input=await body(req),gh=state().github,org=gh.selectedOrganization;
        if(!githubIdentityCurrent(gh)||!org)return deny(409,"Select a GitHub organization");
        if(!Number.isSafeInteger(input.runnerId)||input.runnerId<=0||
          !Array.isArray(input.labels)||input.labels.length>15||
          input.labels.some(l=>typeof l!=="string"||!/^[a-zA-Z0-9_-]{1,40}$/.test(l)))
          return deny(422,"Provide a runner ID and up to 15 valid labels");
        const managed=state().runners.some(r=>r.githubRunnerName===input.runnerName);
        if(!managed||typeof input.runnerName!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(input.runnerName))
          return deny(403,"Only enrolled TinkerTunnel-managed runner labels can be edited");
        // Match the claimed managed runner to the GitHub runner ID before mutating any labels.
        const remote=await fetch("https://api.github.com/orgs/"+encodeURIComponent(org)+"/actions/runners/"+input.runnerId,{
          headers:{authorization:"Bearer "+unseal(gh.oauthToken),
            accept:"application/vnd.github+json","user-agent":"TinkerTunnel",
            "x-github-api-version":"2022-11-28"},signal:AbortSignal.timeout(15000)});
        if(!remote.ok)return deny(502,"Unable to verify GitHub runner identity");
        const identity=await remote.json();
        if(identity.name!==input.runnerName)return deny(403,"GitHub runner ID does not match managed host");
        const labels=[...new Set(input.labels)];
        if(labels.length!==input.labels.length)return deny(422,"Duplicate labels are not allowed");
        const current=state().runners.find(r=>r.githubRunnerName===input.runnerName);
        for(const required of current.labels||[])if(!labels.includes(required))labels.push(required);
        const response=await fetch("https://api.github.com/orgs/"+encodeURIComponent(org)+"/actions/runners/"+input.runnerId+"/labels",{
          method:"PUT",headers:{authorization:"Bearer "+unseal(gh.oauthToken),
            "content-type":"application/json",accept:"application/vnd.github+json",
            "user-agent":"TinkerTunnel","x-github-api-version":"2022-11-28"},
          body:JSON.stringify({labels}),signal:AbortSignal.timeout(15000)});
        if(!response.ok)return deny(response.status===403?403:502,"Could not update GitHub runner labels");
        return reply({updated:true,labels});
      }
      if(path==="/api/local/runners/invite"&&method==="POST"){
        const s=state(),token=rnd();
        s.invites=(s.invites||[]).filter(x=>x.expires>Date.now());
        s.invites.push({hash:digest(token),expires:Date.now()+10*60*1000});
        save(s);return reply({token,expiresInSeconds:600,warning:"Shown once. Do not put this token in Git or logs."});
      }
      return deny(404,"Unknown management endpoint");
    }
    const agentHostResponse=await agentHostRoute(req,{state,save,body,reply,deny,digest,equal,unseal,rnd,githubIdentityCurrent});
     if(agentHostResponse)return agentHostResponse;
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
      runner.lastSeen=new Date().toISOString();
      if(typeof b.hostVersion==="string"&&/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(b.hostVersion)){
       runner.hostVersion=b.hostVersion;
       runner.hostVersionObservedAt=runner.lastSeen;
       if(runner.upgrade?.phase==='installing'&&runner.upgrade.targetVersion===b.hostVersion){
        runner.upgrade.phase='completed';runner.upgrade.completedAt=runner.lastSeen;
       }
      }
      if(Array.isArray(b.packages)&&b.packages.length<=20&&b.packages.every(p=>
       p&&typeof p.name==="string"&&/^[a-z0-9_-]{1,32}$/.test(p.name)&&
       typeof p.version==="string"&&p.version.length<=100)){
        runner.packages=b.packages.map(p=>({name:p.name,version:p.version}));
        runner.packagesObservedAt=runner.lastSeen;
      }
      save(s);return reply({ok:true});
    }
    if(path==="/api/agent/devices"&&method==="POST"){
      const b=await body(req),s=state(),token=(req.headers.get("authorization")||"").replace(/^Bearer /i,"");
      const runner=s.runners.find(x=>x.id===b.id&&equal(x.tokenHash,digest(token)));
      if(!runner)return deny(401,"Invalid runner token");
      try{return reply(reportDevices(runner,b.devices));}
      catch(e){return deny(e.status||422,e.message);}
    }
    if(["/api/agent/jobs/claim","/api/agent/jobs/complete","/api/agent/assets"].includes(path)&&method==="POST"){
      const b=await body(req),s=state(),token=(req.headers.get("authorization")||"").replace(/^Bearer /i,"");
      const runner=s.runners.find(x=>x.id===b.id&&equal(x.tokenHash,digest(token)));
      if(!runner)return deny(401,"Invalid runner token");
      try{
        if(path==="/api/agent/jobs/claim"){
          runner.lastSeen=new Date().toISOString();save(s);
          if(process.env.TT_ENABLE_FABRIC_EXECUTION!=="1")return reply({job:null,executionEnabled:false});
          return reply({...claimJob(runner),executionEnabled:true});
        }
        if(process.env.TT_ENABLE_FABRIC_EXECUTION!=="1")return deny(403,"Runner execution disabled");
        if(path==="/api/agent/jobs/complete")return reply(reportJob(runner,b));
        return reply(agentAsset(runner,b));
      }catch(e){return deny(e.status||422,e.message);}
    }
    if(path==="/api/internal/github/repository/request"&&method==="POST"){
      const service=process.env.TT_SERVICE_TOKEN||"";
      if(service.length<32)return deny(503,"Internal service unavailable");
      if(!equal(req.headers.get("authorization")||"","Bearer "+service))return deny(401,"Unauthorized");
      try{return reply(requestRepositoryFromMcp(await body(req)),202);}
      catch(e){return deny(e.status||422,e.message||"Request rejected");}
    }
    if(path==="/api/internal/fabric"&&method==="POST"){
      const service=process.env.TT_SERVICE_TOKEN||"";
      if(service.length<32)return deny(503,"Internal service unavailable");
      if(!equal(req.headers.get("authorization")||"","Bearer "+service))return deny(401,"Unauthorized");
      const b=await body(req),s=state();
      const ctx={workspace:{name:s.config.name,githubOrganization:githubIdentityCurrent(s.github)?s.github.selectedOrganization:null},
        runners:s.runners.map(r=>({id:r.id,name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen})),
          devices:listDevices({mode:"visible"}).devices};
      try{return reply(applyApprovalPreference(b.tool,b.arguments||{},ctx));}
      catch(e){return deny(e.status||422,e.message);}
    }
    if(path==="/api/internal/status"&&method==="GET"){
      const token=process.env.TT_SERVICE_TOKEN||"";
      if(token.length<32)return deny(503,"Internal service token not configured");
      if(!equal(req.headers.get("authorization")||"","Bearer "+token))return deny(401,"Unauthorized");
      const s=state();return reply({name:s.config.name,githubVerified:!!s.github.verifiedAt,runners:s.runners.map(r=>({name:r.name,os:r.os,arch:r.arch,lastSeen:r.lastSeen})),executionEnabled:process.env.TT_ENABLE_FABRIC_EXECUTION==="1",fabric:fabricStats()});
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
