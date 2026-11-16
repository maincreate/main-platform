import {createHash} from "node:crypto";
import {promises as fs,existsSync} from "node:fs";
import {join,dirname,resolve,sep} from "node:path";
import {homedir,platform,arch} from "node:os";
import {spawn} from "node:child_process";

export const ESP_IDF_RELEASES=Object.freeze({
 "5.5.6":{
  eim:"0.20.0",
  targets:{
   "linux/arm64":{url:"https://github.com/espressif/idf-im-ui/releases/download/v0.20.0/eim-cli-linux-aarch64-v0.20.0.zip",sha256:"e35c9a367c02b38fc27e39f292db8907e5131468d9b851ce1af8affe933be622"},
   "linux/x64":{url:"https://github.com/espressif/idf-im-ui/releases/download/v0.20.0/eim-cli-linux-x64-v0.20.0.zip",sha256:"3a34d24b7f039d8b9baeb505e88e0d4d257522fab6c13c2ef3f1510220cb0c5a"}
  }
 },
 "6.1.1":{
  eim:"0.20.0",
  targets:{
   "linux/arm64":{url:"https://github.com/espressif/idf-im-ui/releases/download/v0.20.0/eim-cli-linux-aarch64-v0.20.0.zip",sha256:"e35c9a367c02b38fc27e39f292db8907e5131468d9b851ce1af8affe933be622"},
   "linux/x64":{url:"https://github.com/espressif/idf-im-ui/releases/download/v0.20.0/eim-cli-linux-x64-v0.20.0.zip",sha256:"3a34d24b7f039d8b9baeb505e88e0d4d257522fab6c13c2ef3f1510220cb0c5a"}
  }
 }
});

export const ANDROID_RELEASE={
 version:"2026.2.2-patch1",
 commandLineTools:"15859902",
 packages:["platform-tools","build-tools;36.0.0","platforms;android-37","platforms;android-22"],
 hosts:{
  "linux/x64":{url:"https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip",sha256:"4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"}
 }
};

const hostKey=(os,architecture)=>os+"/"+architecture;
export const sdkRoot=(base=join(homedir(),".local","share","maincreate","sdks"))=>resolve(base);
export const espIdfRoot=(version,base=sdkRoot())=>join(base,"esp-idf",version);
export const androidRoot=(base=sdkRoot())=>join(base,"android","2026.2.2-patch1");

async function run(bin,args,{cwd,timeout=30*60*1000,env={},input=""}={}){
 return new Promise((resolvePromise,reject)=>{
  const child=spawn(bin,args,{cwd,shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"],env:{...process.env,...env}});
  let output="",timer=setTimeout(()=>child.kill("SIGKILL"),timeout);
  const capture=x=>{output+=String(x);if(output.length>20000)output=output.slice(-20000);};
  child.stdout.on("data",capture);child.stderr.on("data",capture);child.stdin.end(input);
  child.once("error",e=>{clearTimeout(timer);reject(e);});
  child.once("close",code=>{clearTimeout(timer);code===0?resolvePromise(output):reject(new Error((output.trim().slice(-3000)||bin)+" (exit "+code+")"));});
 });
}
async function download(url,maxBytes=256*1024*1024){
 const allowed=new Set(["github.com","objects.githubusercontent.com","release-assets.githubusercontent.com","dl.google.com"]);
 let current=new URL(url);
 for(let i=0;i<=4;i++){
  if(current.protocol!=="https:"||!allowed.has(current.hostname))throw new Error("Unapproved toolkit download origin");
  const response=await fetch(current,{redirect:"manual",signal:AbortSignal.timeout(10*60*1000)});
  if(response.status>=300&&response.status<400){const loc=response.headers.get("location");if(!loc)throw new Error("Missing download redirect");current=new URL(loc,current);continue;}
  if(!response.ok)throw new Error("Toolkit download HTTP "+response.status);
  const length=Number(response.headers.get("content-length")||0);if(length>maxBytes)throw new Error("Toolkit archive exceeds size limit");
  const reader=response.body?.getReader();if(!reader)throw new Error("Toolkit download has no body");
  const chunks=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes)throw new Error("Toolkit archive exceeds size limit");chunks.push(Buffer.from(value));}
  return Buffer.concat(chunks,total);
 }
 throw new Error("Too many toolkit download redirects");
}
function verifyDigest(data,expected){const actual=createHash("sha256").update(data).digest("hex");if(actual!==expected)throw new Error("Toolkit archive SHA-256 mismatch");return actual;}
function safeArchivePath(name,root){
 if(typeof name!=="string"||!name||name.includes("\\")||name.startsWith("/")||name.split("/").includes(".."))return false;
 const target=resolve(root,name);return target.startsWith(resolve(root)+sep);
}
async function extractZip(data,dest,{maxEntries=20000,maxExpanded=3*1024*1024*1024}={}){
 await fs.mkdir(dest,{recursive:true,mode:0o700});
 const tmp=join(dirname(dest),".archive-"+process.pid+"-"+Date.now()+".zip");
 await fs.writeFile(tmp,data,{mode:0o600,flag:"wx"});
 try{
  const listing=await run("unzip",["-Z1",tmp],{timeout:120000});
  const names=listing.split(/\r?\n/).filter(Boolean);
  if(!names.length||names.length>maxEntries||names.some(n=>!safeArchivePath(n,dest)))throw new Error("Unsafe or oversized toolkit ZIP archive");
  const info=await run("unzip",["-l",tmp],{timeout:120000});
  const sizes=[...info.matchAll(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2}/gm)].map(x=>Number(x[1]));
  if(sizes.reduce((a,b)=>a+b,0)>maxExpanded)throw new Error("Toolkit ZIP expands beyond configured limit");
  await run("unzip",["-q",tmp,"-d",dest],{timeout:10*60*1000});
  return names;
 }finally{await fs.rm(tmp,{force:true});}
}
async function atomicReplace(stage,target){
 const backup=target+".previous";await fs.rm(backup,{recursive:true,force:true});
 if(existsSync(target))await fs.rename(target,backup);
 try{await fs.rename(stage,target);await fs.rm(backup,{recursive:true,force:true});}
 catch(e){await fs.rm(target,{recursive:true,force:true});if(existsSync(backup))await fs.rename(backup,target);throw e;}
}
function osName(){return ({linux:"linux",darwin:"macos",win32:"windows"})[platform()];}
function archName(){return ({x64:"x64",arm64:"arm64"})[arch()];}


export function validateFirmwareManifest(value,{version,chip}={}){
 if(!value||typeof value!=="object"||value.kind!=="maincreate-esp-idf-firmware-bundle"||
  !["5.5.6","6.1.1"].includes(value.toolkitVersion)||value.toolkitVersion!==version||
  typeof value.targetChip!=="string"||value.targetChip.toLowerCase()!==String(chip||"").toLowerCase()||
  !/^[a-f0-9]{40}$/i.test(value.sourceRevision||"")||
  !/^[a-f0-9]{64}$/.test(value.bundleSha256||""))
  throw new Error("Firmware bundle manifest does not match the approved toolkit, target chip, revision or checksum");
 return value;
}
export function validateFlasherArgs(value,root){
 if(!value||typeof value!=="object"||!value.flash_files||typeof value.flash_files!=="object"||
  Array.isArray(value.flash_files)||Object.keys(value.flash_files).length<1||Object.keys(value.flash_files).length>32)
  throw new Error("Invalid ESP-IDF flasher_args.json");
 const files=[];
 for(const [address,name] of Object.entries(value.flash_files)){
  if(!/^0x[0-9a-fA-F]{1,8}$/.test(address)||typeof name!=="string"||
   name.startsWith("/")||name.includes("\\\\")||name.split("/").includes(".."))
   throw new Error("Unsafe firmware flash entry");
  const file=resolve(root,name);if(!file.startsWith(resolve(root)+sep))throw new Error("Firmware file escaped bundle root");
  files.push({address:Number.parseInt(address,16),file});
 }
 const flags=Array.isArray(value.write_flash_args)?value.write_flash_args:[];
 const allowed=new Set(["--flash-mode","--flash-freq","--flash-size","--compress","--no-compress","--erase-all","--force"]);
 for(let i=0;i<flags.length;i++){
  if(!allowed.has(flags[i]))throw new Error("Unsupported ESP-IDF flash option");
  if(flags[i].startsWith("--")&&!["--compress","--no-compress","--erase-all","--force"].includes(flags[i])){
   const v=flags[++i];if(typeof v!=="string"||!/^([A-Za-z0-9]+)$/.test(v))throw new Error("Invalid ESP-IDF flash option value");
  }
 }
 return {files,writeFlashArgs:flags};
}

export async function installEspIdf({version,os=osName(),architecture=archName(),root=sdkRoot(),downloadFn=download,runner=run}={}){
 const release=ESP_IDF_RELEASES[version];if(!release)throw new Error("ESP-IDF version is not in the approved marketplace catalog");
 const recipe=release.targets[hostKey(os,architecture)];if(!recipe)throw new Error("ESP-IDF is not supported on this builder OS/architecture");
 const archive=await downloadFn(recipe.url);const digest=verifyDigest(archive,recipe.sha256);
 const parent=join(root,"esp-idf",version);await fs.mkdir(dirname(parent),{recursive:true,mode:0o700});
 const stage=await fs.mkdtemp(join(dirname(parent),".stage-"+version+"-"));
 try{
  await extractZip(archive,stage,{maxEntries:128,maxExpanded:128*1024*1024});
  const binaries=[];async function walk(dir,depth=0){if(depth>4)return;for(const ent of await fs.readdir(dir,{withFileTypes:true})){const p=join(dir,ent.name);if(ent.isDirectory())await walk(p,depth+1);else if(ent.isFile()&&ent.name==="eim")binaries.push(p);}}
  await walk(stage);if(binaries.length!==1)throw new Error("EIM archive must contain exactly one CLI binary");
  const eim=binaries[0];await fs.chmod(eim,0o755);
  const actual=(await runner(eim,["--version"],{timeout:30000})).trim();
  if(!actual.includes(release.eim))throw new Error("Unexpected EIM version: "+actual);
  const idfPath=join(parent,"idf");
  await fs.mkdir(parent,{recursive:true,mode:0o700});
  await runner(eim,["--do-not-track","true","install","-i","v"+version,"-p",idfPath,"-n","true"],{timeout:90*60*1000,env:{ESP_PATH:parent}});
  let exportScript=null;async function findExport(dir,depth=0){if(depth>5)return;for(const ent of await fs.readdir(dir,{withFileTypes:true})){const p=join(dir,ent.name);if(ent.isDirectory())await findExport(p,depth+1);else if(ent.isFile()&&ent.name==="export.sh")exportScript=p;}}
  await findExport(idfPath);
  if(!exportScript)throw new Error("EIM completed without the expected ESP-IDF export.sh");
  const verify=await runner("bash",["-lc",'source "$1" >/dev/null && idf.py --version', "maincreate",exportScript],{timeout:60000});
  if(!verify.includes(version))throw new Error("Installed ESP-IDF version mismatch: "+verify.trim());
  await fs.mkdir(join(parent,"metadata"),{recursive:true,mode:0o700});
  await fs.writeFile(join(parent,"metadata","maincreate-install.json"),JSON.stringify({family:"esp-idf",version,os,architecture,eimVersion:release.eim,sha256:digest,installedAt:new Date().toISOString()},null,2),{mode:0o600});
  return {family:"esp-idf",version,status:"installed",path:idfPath,eimVersion:release.eim,sha256:digest};
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}

export async function installAndroidSdk({os=osName(),architecture=archName(),root=sdkRoot(),acceptLicenses=false,downloadFn=download,runner=run}={}){
 if(!acceptLicenses)throw new Error("Android SDK license acceptance is required before installation");
 const recipe=ANDROID_RELEASE.hosts[hostKey(os,architecture)];if(!recipe)throw new Error("Google Android command-line tools are not supported on this builder OS/architecture");
 const archive=await downloadFn(recipe.url);const digest=verifyDigest(archive,recipe.sha256);
 const parent=androidRoot(root);await fs.mkdir(dirname(parent),{recursive:true,mode:0o700});
 const stage=await fs.mkdtemp(join(dirname(parent),".stage-android-"));
 try{
  const extracted=join(stage,"extracted");await extractZip(archive,extracted,{maxEntries:20000,maxExpanded:2*1024*1024*1024});
  const sdkmanagerCandidates=[];async function walk(dir,depth=0){if(depth>6)return;for(const ent of await fs.readdir(dir,{withFileTypes:true})){const p=join(dir,ent.name);if(ent.isDirectory())await walk(p,depth+1);else if(ent.isFile()&&ent.name==="sdkmanager")sdkmanagerCandidates.push(p);}}
  await walk(extracted);if(sdkmanagerCandidates.length!==1)throw new Error("Android archive must contain exactly one sdkmanager");
  const cmdlineRoot=join(stage,"cmdline-tools","latest");await fs.mkdir(cmdlineRoot,{recursive:true,mode:0o700});
  const source=dirname(dirname(sdkmanagerCandidates[0]));
  await fs.cp(source,cmdlineRoot,{recursive:true,force:true});
  const sdkmanager=join(cmdlineRoot,"bin","sdkmanager");
  await fs.chmod(sdkmanager,0o755);
  const sdkRootPath=join(stage,"sdk");await fs.mkdir(sdkRootPath,{recursive:true,mode:0o700});
  const packages=[...ANDROID_RELEASE.packages];
  await runner(sdkmanager,["--sdk_root="+sdkRootPath,"--licenses"],{timeout:10*60*1000,env:{ANDROID_HOME:sdkRootPath,ANDROID_SDK_ROOT:sdkRootPath},input:"y\n".repeat(100)});
  await runner(sdkmanager,["--sdk_root="+sdkRootPath,...packages],{timeout:90*60*1000,env:{ANDROID_HOME:sdkRootPath,ANDROID_SDK_ROOT:sdkRootPath}});
  const platformTools=join(sdkRootPath,"platform-tools","adb");
  const buildTools=join(sdkRootPath,"build-tools","36.0.0","aapt2");
  const platform=join(sdkRootPath,"platforms","android-22","android.jar");
  for(const p of [platformTools,buildTools,platform])if(!existsSync(p))throw new Error("Android SDK package missing after installation: "+p);
  const meta={family:"android-sdk",version:ANDROID_RELEASE.version,commandLineTools:ANDROID_RELEASE.commandLineTools,os,architecture,packages,sha256:digest,licensesAccepted:true,installedAt:new Date().toISOString()};
  await fs.writeFile(join(sdkRootPath,".maincreate-install.json"),JSON.stringify(meta,null,2),{mode:0o600});
  await atomicReplace(stage,parent);
  return {family:"android-sdk",version:ANDROID_RELEASE.version,status:"installed",path:parent,sha256:digest,packages};
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}

export async function inspectInstalledToolkit({family,version,root=sdkRoot()}={}){
 if(family==="esp-idf"){
  const p=join(espIdfRoot(version,root),"idf");
  if(!existsSync(p))return {installed:false};
  let exportScript=null;async function findExport(dir,depth=0){if(depth>5)return;for(const ent of await fs.readdir(dir,{withFileTypes:true})){const child=join(dir,ent.name);if(ent.isDirectory())await findExport(child,depth+1);else if(ent.isFile()&&ent.name==="export.sh")exportScript=child;}}
  await findExport(p);if(!exportScript)return {installed:false};
  const output=await run("bash",["-lc",'source "$1" >/dev/null && idf.py --version',"maincreate",exportScript],{timeout:60000});
  return {installed:output.includes(version),version,executable:"idf.py",path:p,exportScript};
 }
 if(family==="android-sdk"){
  const p=join(androidRoot(root),"sdk");
  if(!existsSync(join(p,"platform-tools","adb"))||!existsSync(join(p,"build-tools","36.0.0","aapt2")))return {installed:false};
  const output=await run(join(p,"platform-tools","adb"),["version"],{timeout:30000});
  return {installed:true,version:ANDROID_RELEASE.version,adb:output.split("\n")[0],path:p};
 }
 throw new Error("Unknown toolkit family");
}

export async function cleanupToolkit({family,version,root=sdkRoot(),dryRun=true,activeJobs=[]}={}){
 if(activeJobs.length)throw new Error("Cannot clean up a toolkit while active jobs reference it");
 let target;
 if(family==="esp-idf")target=espIdfRoot(version,root);
 else if(family==="android-sdk"&&version===ANDROID_RELEASE.version)target=androidRoot(root);
 else throw new Error("Unsupported toolkit cleanup request");
 const absolute=resolve(target),base=resolve(root);
 if(!absolute.startsWith(base+sep))throw new Error("Cleanup path escaped managed SDK root");
 const exists=existsSync(absolute);
 if(dryRun)return {dryRun:true,family,version,path:absolute,exists,deleted:false};
 if(exists)await fs.rm(absolute,{recursive:true,force:true});
 return {dryRun:false,family,version,path:absolute,exists,deleted:exists};
}
