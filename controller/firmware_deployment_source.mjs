/**
 * GitHub Actions source resolver for a one-command ESP32-S3 deployment.
 * Production writes only accept a successful main-branch Actions run with
 * verified source, board profile, toolchain and binary hashes.
 */
import {decodeFirmwareZip,validateExpressionArtifacts} from "./github_firmware_import.mjs";
const REPOSITORY="BuilderBench/esp32-expression";
const WORKFLOW=".github/workflows/arduino-build.yml";
const ARTIFACT="luma-pet-esp32s3-touch-lcd-1.85B-34554";
const BASE="https://api.github.com/repos/BuilderBench/esp32-expression";
const err=(msg,code=422)=>Object.assign(new Error(msg),{status:code});
const success=run=>run?.head_repository?.full_name===REPOSITORY&&
 run.head_branch==="main"&&run.event==="push"&&
 run.status==="completed"&&run.conclusion==="success"&&
 /^[a-f0-9]{40}$/.test(run.head_sha||"")&&
 run.path===WORKFLOW&&Number.isSafeInteger(run.id);

export async function fetchVerifiedExpressionFirmware({token,runId,fetchImpl=fetch}){
 if(typeof token!=="string"||token.length<20)throw err("Authorized GitHub connection required",409);
 if(runId!==undefined&&runId!==null&&(!Number.isSafeInteger(runId)||runId<1))
  throw err("Invalid exact GitHub Actions run ID");
 const headers={authorization:"Bearer "+token,accept:"application/vnd.github+json",
  "x-github-api-version":"2022-11-28","user-agent":"Main{Create}"};
 async function json(path){
  const res=await fetchImpl(BASE+path,{headers,redirect:"follow",signal:AbortSignal.timeout(18000)});
  if(!res.ok)throw err("GitHub Actions API unavailable (HTTP "+res.status+")",res.status===403?403:502);
  return res.json();
 }
 let run;
 if(runId){
  run=await json("/actions/runs/"+runId);
 }else{
  const runs=await json("/actions/workflows/arduino-build.yml/runs?branch=main&event=push&status=success&per_page=20");
  run=(runs.workflow_runs||[]).find(success);
  if(!run)throw err("No successful approved main-branch Expressions workflow found",409);
  // Fetch the run record independently rather than trusting list metadata alone.
  run=await json("/actions/runs/"+run.id);
 }
 if(!success(run))throw err("Run must be successful, non-fork, main-branch Expressions build");
 if(!runId){
  const branch=await json("/branches/main");
  if(!/^[a-f0-9]{40}$/.test(branch?.commit?.sha||"")||
     branch.commit.sha!==run.head_sha)
   throw err("A newer main-branch source revision has not passed the production build; refusing to flash older firmware",409);
 }

 const listing=await json("/actions/runs/"+run.id+"/artifacts?per_page=100");
 const matching=(listing.artifacts||[]).filter(a=>a.name===ARTIFACT&&!a.expired);
 if(matching.length!==1||!Number.isSafeInteger(matching[0].id)||
  !Number.isSafeInteger(matching[0].size_in_bytes)||
  matching[0].size_in_bytes<1||matching[0].size_in_bytes>12*1024*1024)
  throw err("Run lacks a unique, bounded, non-expired reviewed firmware artifact");
 const res=await fetchImpl(BASE+"/actions/artifacts/"+matching[0].id+"/zip",
  {headers,redirect:"follow",signal:AbortSignal.timeout(30000)});
 if(!res.ok||!res.body)throw err("GitHub firmware download unavailable",502);
 const chunks=[];let length=0;
 for await(const chunk of res.body){
  length+=chunk.length;
  if(length>12*1024*1024)throw err("Firmware archive size limit exceeded");
  chunks.push(Buffer.from(chunk));
 }
 const files=decodeFirmwareZip(Buffer.concat(chunks));
 const validated=validateExpressionArtifacts(files,{repository:REPOSITORY,revision:run.head_sha});
 return {...validated,runId:run.id,artifactId:matching[0].id,workflow:WORKFLOW};
}
