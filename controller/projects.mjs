import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,chmodSync} from "node:fs";
import {join} from "node:path";
import {randomBytes} from "node:crypto";

const root=process.env.TT_DATA_DIR||"./.tinkertunnel-data";
const path=join(root,"projects.json");
const err=(status,message)=>Object.assign(new Error(message),{status});
function load(){
 if(!existsSync(path))return {version:1,organization:null,updatedAt:null,repositories:[]};
 const data=JSON.parse(readFileSync(path,"utf8"));
 if(data.version!==1||!Array.isArray(data.repositories))throw err(503,"Project inventory unavailable");
 return data;
}
function save(data){
 mkdirSync(root,{recursive:true,mode:0o700});
 const tmp=join(root,".projects-"+randomBytes(12).toString("hex"));
 writeFileSync(tmp,JSON.stringify(data),{mode:0o600,flag:"wx"});
 renameSync(tmp,path);chmodSync(path,0o600);
}
export function listProjects(org,jobs=[]){
 const db=load();
 if(!org||db.organization!==org)return {repositories:[],organization:org||null,updatedAt:null,connected:!!org};
 const repos=db.repositories.map(r=>{
  const builds=jobs.filter(j=>j.source?.repository===r.fullName);
  return {...r,builds:builds.length,
   latestBuild:builds.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]||null};
 });
 return {repositories:repos,organization:org,updatedAt:db.updatedAt,connected:true,
  truncated:!!db.truncated};
}
export async function syncProjects({organization,installationId,accessToken}){
 if(!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(organization||"")||
  !Number.isSafeInteger(installationId)||installationId<=0||typeof accessToken!=="string"||
  accessToken.length<20)throw err(422,"Valid GitHub installation credentials required");
 const headers={"accept":"application/vnd.github+json","authorization":"Bearer "+accessToken,
  "x-github-api-version":"2022-11-28","user-agent":"TinkerTunnel"};
 const repos=[],seen=new Set();let truncated=false;
 for(let page=1;page<=5;page++){
  const u="https://api.github.com/user/installations/"+installationId+
   "/repositories?per_page=100&page="+page;
  const response=await fetch(u,{headers,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw err(502,"GitHub repository inventory failed (HTTP "+response.status+")");
  const data=await response.json();
  if(!Array.isArray(data.repositories))throw err(502,"Unexpected GitHub repository response");
  for(const r of data.repositories){
   if(typeof r.full_name!=="string"||!r.full_name.startsWith(organization+"/")||
    typeof r.html_url!=="string"||!r.html_url.startsWith("https://github.com/")||
    !Number.isSafeInteger(r.id)||seen.has(r.id))continue;
   seen.add(r.id);
   repos.push({id:r.id,fullName:r.full_name,description:typeof r.description==="string"?r.description.slice(0,200):"",
    url:r.html_url,defaultBranch:typeof r.default_branch==="string"?r.default_branch:null,
    pushedAt:r.pushed_at||null,archived:!!r.archived,private:!!r.private});
  }
  if(data.repositories.length<100)break;
  if(page===5)truncated=true;
 }
 const result={version:1,organization,updatedAt:new Date().toISOString(),repositories:repos,truncated};
 save(result);
 return {organization,repositories:repos,updatedAt:result.updatedAt,truncated};
}
