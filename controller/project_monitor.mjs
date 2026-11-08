/** Repo requirements and compatibility monitor. No arbitrary source execution.
 * Manifest: .tinkertunnel/project.json
 * {"schema":1,"targets":[{"os":"linux","arch":"arm64","tools":[{"name":"esp-idf","version":"5.5.x"}]}]}
 * targets are alternatives (OR); tools within a target are requirements (AND).
 */
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from "node:fs";
import {join} from "node:path";
import {randomBytes} from "node:crypto";

const dir=process.env.TT_DATA_DIR||"./.tinkertunnel-data", location=join(dir,"project-monitor.json");
const pending=new Map();
const osNames=new Set(["linux","macos","windows"]);
const toolNames=new Set(["esp-idf","xcode","ios-sdk","node","cmake","gcc","python3","swift","git"]);
const repoName=name=>typeof name==="string"&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name);
const cleanVersion=v=>typeof v==="string"&&/^(?:[0-9]+(?:\.[0-9]+){0,2}(?:\.x)?|>=\s*[0-9]+(?:\.[0-9]+){0,2})$/.test(v.trim())?v.trim():null;
const normalizeTarget=t=>{
 if(!t||typeof t!=="object"||!osNames.has(t.os))throw Error("Invalid platform in project requirements");
 const arch=t.arch??null;
 if(arch!==null&&!["arm64","x64"].includes(arch))throw Error("Invalid architecture");
 if(!Array.isArray(t.tools)||t.tools.length>12)throw Error("Invalid tool requirements");
 const tools=t.tools.map(item=>{
  if(!item||typeof item!=="object"||!toolNames.has(item.name))throw Error("Unsupported tool requirement");
  const version=item.version==null?null:cleanVersion(item.version);
  if(item.version!=null&&!version)throw Error("Unsupported tool version constraint");
  return {name:item.name,version};
 });
 return {os:t.os,arch,tools};
};
export function parseRequirements(text){
 if(typeof text!=="string"||text.length>16384)throw Error("Manifest too large");
 const manifest=JSON.parse(text);
 if(manifest?.schema!==1||!Array.isArray(manifest.targets)||!manifest.targets.length||manifest.targets.length>8)throw Error("Invalid TinkerTunnel project manifest");
 return {status:"declared",targets:manifest.targets.map(normalizeTarget),source:".tinkertunnel/project.json"};
}
export function inferRequirementsFromWorkflows(files){
 const targets=[];for(const text of files){
  // Deliberately conservative: only literal OS labels and explicitly declared SDK versions.
  const found=new Set();
  for(const match of String(text).matchAll(/runs-on\s*:\s*(?:["']?)(macos(?:-[A-Za-z0-9._-]+)?|ubuntu(?:-[A-Za-z0-9._-]+)?|windows(?:-[A-Za-z0-9._-]+)?)(?:["']?)/ig)){
   const val=match[1].toLowerCase();
   found.add(val.startsWith("macos")?"macos":val.startsWith("ubuntu")?"linux":"windows");
  }
  const idf=/\b(?:esp_idf_version|esp-idf-version|idf_version)\s*:\s*["']?v?(\d+\.\d+(?:\.\d+)?)/i.exec(text);
  const xcode=/\b(?:xcode-version|xcode_version|xcode)\s*:\s*["']?(\d+(?:\.\d+){0,2})/i.exec(text);
  if(found.size===1){
   const os=[...found][0],tools=[];
   if(idf)tools.push({name:"esp-idf",version:idf[1]});
   else if(/\b(?:esp-idf|idf\.py|esp_idf|espressif)\b/i.test(text))tools.push({name:"esp-idf",version:null});
   if(os==="macos"&&xcode)tools.push({name:"xcode",version:xcode[1]});
   else if(os==="macos"&&/\b(?:xcodebuild|xcode|ios|iphone|fastlane)\b/i.test(text))
    tools.push({name:"xcode",version:null});
   targets.push({os,arch:null,tools});
  }
 }
 const unique=[...new Map(targets.map(t=>[JSON.stringify(t),t])).values()];
 return unique.length?{status:"inferred",targets:unique.slice(0,8),source:".github/workflows"}:
  {status:"unknown",targets:[],source:null};
}
export function versionSatisfied(actual,constraint){
 if(!constraint)return true;
 if(typeof actual!=="string")return false;
 const match=/\b(\d+(?:\.\d+){0,2})\b/.exec(actual);if(!match)return false;
 const v=match[1].split(".").map(Number);
 const target=constraint.replace(/^>=\s*/,"").replace(/\.x$/,"").split(".").map(Number);
 if(constraint.startsWith(">=")){
  for(let i=0;i<3;i++){const a=v[i]||0,b=target[i]||0;if(a>b)return true;if(a<b)return false}return true;
 }
 return target.every((n,i)=>v[i]===n);
}
export function evaluateProject(requirements,runners=[]){
 if(!requirements||!["declared","inferred"].includes(requirements.status)||!requirements.targets?.length)
  return {status:"unknown",matches:[],reason:"No reliable platform requirements detected"};
 const online=runners.filter(r=>r.githubRunnerName&&r.lastSeen&&Date.now()-Date.parse(r.lastSeen)<120000);
 const matches=online.filter(r=>requirements.targets.some(t=>
  r.os===t.os&&(!t.arch||r.arch===t.arch)&&t.tools.every(tool=>
   (r.packages||[]).some(p=>p.name===tool.name&&versionSatisfied(p.version,tool.version))
  )));
 return matches.length?{status:"compatible",matches:matches.map(r=>r.name),reason:matches.length+" compatible online managed builder(s)"}:
  {status:"missing",matches:[],reason:"No online managed GitHub runner matches the required OS, architecture and tool versions"};
}
function database(){
 if(!existsSync(location))return {schema:1,repositories:{}};
 const data=JSON.parse(readFileSync(location,"utf8"));
 if(data?.schema!==1||typeof data.repositories!=="object")throw Error("Invalid project monitor state");
 return data;
}
function save(data){
 mkdirSync(dir,{recursive:true,mode:0o700});const temp=join(dir,".project-monitor-"+randomBytes(8).toString("hex"));
 writeFileSync(temp,JSON.stringify(data),{mode:0o600,flag:"wx"});renameSync(temp,location);
}
export function setProjectIgnored(fullName,ignored){
 if(!repoName(fullName)||typeof ignored!=="boolean")throw Error("Invalid project preference");
 const db=database(),entry=db.repositories[fullName]||{};
 db.repositories[fullName]={...entry,ignored,changedAt:new Date().toISOString()};save(db);
 return {fullName,ignored};
}
export function projectSummary(repositories,runners=[]){
 const db=database(),items=repositories.map(r=>{
  const entry=db.repositories[r.fullName]||{},requirements=entry.requirements||{status:"unknown",targets:[],source:null};
  const evaluation=evaluateProject(requirements,runners);
  const ignored=!!entry.ignored,muted=ignored||!!r.archived;
  return {...r,requirements,compatibility:evaluation,ignored,alert:!muted&&evaluation.status==="missing"};
 });
 return {repositories:items,alerts:items.filter(r=>r.alert).length,unknown:items.filter(r=>r.compatibility.status==="unknown"&&!r.ignored&&!r.archived).length};
}
const gitHeaders=token=>({"authorization":"Bearer "+token,"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28","user-agent":"TinkerTunnel"});
async function githubGet(fullName,path,token){
 const url="https://api.github.com/repos/"+fullName.split("/").map(encodeURIComponent).join("/")+"/contents/"+path;
 const response=await fetch(url,{headers:gitHeaders(token),signal:AbortSignal.timeout(12000)});
 if(response.status===404)return null;
 if(!response.ok)throw Error("GitHub requirements read HTTP "+response.status);
 return response.json();
}
function decodedFile(body){
 if(!body||body.type!=="file"||body.encoding!=="base64"||typeof body.content!=="string"||body.size>16384)return null;
 return Buffer.from(body.content.replace(/\s/g,""),"base64").toString("utf8");
}
export async function detectProjectRequirements(fullName,token){
 if(!repoName(fullName))throw Error("Invalid repository name");
 const manifest=decodedFile(await githubGet(fullName,".tinkertunnel/project.json",token));
 if(manifest!==null)return parseRequirements(manifest);
 const listing=await githubGet(fullName,".github/workflows",token);
 if(!Array.isArray(listing))return {status:"unknown",targets:[],source:null};
 const files=[];
 for(const entry of listing.filter(item=>item.type==="file"&&/\.ya?ml$/.test(item.name||"")).slice(0,6)){
  const raw=decodedFile(await githubGet(fullName,".github/workflows/"+encodeURIComponent(entry.name),token));
  if(raw)files.push(raw);
 }
 return inferRequirementsFromWorkflows(files);
}
export function requestRequirementRefresh({organization,accessToken,repositories,limit=25}){
 if(typeof accessToken!=="string"||!accessToken||typeof organization!=="string"||!Array.isArray(repositories))return;
 if(pending.has(organization))return;
 const items=repositories.filter(r=>r.fullName.startsWith(organization+"/")&&!r.archived);
 const db=database(),now=Date.now();
 const stale=items.filter(r=>!db.repositories[r.fullName]?.checkedAt||
  now-Date.parse(db.repositories[r.fullName].checkedAt)>6*60*60*1000).slice(0,limit);
 if(!stale.length)return;
 const task=(async()=>{
  let cursor=0;
  async function worker(){
   for(;;){
    const repo=stale[cursor++];if(!repo)return;
    try{
     const requirements=await detectProjectRequirements(repo.fullName,accessToken);
     const existing=database();existing.repositories[repo.fullName]={...existing.repositories[repo.fullName],requirements,checkedAt:new Date().toISOString()};
     save(existing);
    }catch(e){
     const existing=database();existing.repositories[repo.fullName]={...existing.repositories[repo.fullName],
      scanError:String(e.message||"Requirements check failed").slice(0,120),checkedAt:new Date().toISOString()};
     save(existing);
    }
   }
  }
  await Promise.all(Array.from({length:Math.min(3,stale.length)},()=>worker()));
 })().finally(()=>pending.delete(organization));
 pending.set(organization,task);
}
