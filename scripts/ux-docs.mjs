#!/usr/bin/env node
/**
 * Support documentation from the versioned UX contract.
 * Usage: node scripts/ux-docs.mjs --write | --check
 * No API calls, browser inference or running controller required.
 */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=join(dirname(fileURLToPath(import.meta.url)),"..");
export const contract=JSON.parse(readFileSync(join(root,"registry/ux-flows.json"),"utf8"));
const clean=s=>String(s).replaceAll("|","\\|").replaceAll("\n"," ");
export function validateFlows(data){
 if(data.schema!==1||!Array.isArray(data.flows)||!data.flows.length)throw Error("Invalid UX flow schema");
 const ids=new Set();
 for(const flow of data.flows){
  if(!/^[a-z][a-z0-9-]+$/.test(flow.id)||ids.has(flow.id))throw Error("Duplicate or invalid flow ID");
  ids.add(flow.id);
  if(!["implemented","pilot","planned"].includes(flow.status))throw Error("Unknown status: "+flow.id);
  if(!flow.title||!flow.route?.startsWith("/")||!flow.entry||!flow.owner)throw Error("Missing entry points: "+flow.id);
  if(!flow.steps?.length||!flow.paths?.success)throw Error("Missing steps or success route: "+flow.id);
  const steps=new Set();
  for(const step of flow.steps){
   if(!/^[a-z][a-z0-9-]+$/.test(step.id)||steps.has(step.id))throw Error("Duplicate stage: "+flow.id);
   steps.add(step.id);
   for(const field of ["title","userAction","success","failure","recovery"])
    if(typeof step[field]!=="string"||!step[field].trim())throw Error(flow.id+"."+step.id+": missing "+field);
  }
  if(!Array.isArray(flow.limitations)||!flow.limitations.length)throw Error("Missing limitations: "+flow.id);
 }
 return true;
}
export function renderFlow(flow){
 return [
  "# "+flow.title,
  "",
  "> Status: **"+flow.status+"** · UX contract: `"+flow.id+"` · Version: `"+contract.version+"`",
  "",
  "**Where:** ["+flow.route+"]("+flow.route+") · **Entry:** "+flow.entry,
  "",
  "**Outcome:** "+flow.paths.success,
  flow.paths.resume?"\n**Resume:** "+flow.paths.resume:"",
  "",
  "## User journey",
  "",
  "| Step | What you do | Confirmation | When it fails | Recovery |",
  "| --- | --- | --- | --- | --- |",
  ...flow.steps.map((s,i)=>"| "+(i+1)+". "+clean(s.title)+" | "+clean(s.userAction)+" | "+clean(s.success)+" | "+clean(s.failure)+" | "+clean(s.recovery)+" |"),
  "",
  "## Known limitations",
  "",
  ...flow.limitations.map(s=>"- "+s),
  "",
  "## Support escalation",
  "",
  "Record the flow ID, current stage ID, host/device ID (not credentials), timestamp and observed controller state. Do not infer success from an animation, pending stage or stale heartbeat.",
  "",
  "_Generated from `registry/ux-flows.json`. Edit the manifest, not this page._",
  ""
 ].filter(x=>x!==null).join("\n");
}
export function documents(data=contract){
 validateFlows(data);
 return new Map(data.flows.map(flow=>["docs/support/"+flow.id+".md",renderFlow(flow)]));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===join(root,"scripts/ux-docs.mjs")){
 const mode=process.argv[2];if(!["--write","--check"].includes(mode))throw Error("Use --write or --check");
 for(const [path,content] of documents()){
  const absolute=join(root,path);
  if(mode==="--write"){
   mkdirSync(dirname(absolute),{recursive:true});writeFileSync(absolute,content);
  }else{
   let existing;try{existing=readFileSync(absolute,"utf8")}catch{throw Error("Missing generated document: "+path)}
   if(existing!==content)throw Error("Generated document is stale: "+path+". Run npm run docs:generate.");
  }
 }
 console.log(mode==="--check"?"UX support documentation is up to date.":"UX support documentation generated.");
}
