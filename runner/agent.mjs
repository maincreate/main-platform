import {readFileSync,writeFileSync,mkdirSync,chmodSync,statSync,realpathSync,readdirSync,cpSync,mkdtempSync,rmSync,lstatSync} from "node:fs";
import {join,resolve,isAbsolute,sep,dirname} from "node:path";
import {homedir,hostname,platform,arch,cpus,totalmem,freemem,uptime} from "node:os";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {installArduinoCli,installedArduinoCli,isExactArduinoVersion} from "./sdk_install.mjs";
import {installEspIdf,installAndroidSdk,inspectInstalledToolkit,espIdfRoot,androidRoot,validateFirmwareManifest,validateFlasherArgs} from "./marketplace_toolkits.mjs";

const configDir=process.env.MAIN_RUNNER_STATE_DIR||join(homedir(),".maincreate");
const path=join(configDir,"runner.json");
const command=process.argv[2]||"run",endpoint=process.env.MAIN_CONTROLLER_URL||"http://portal:3000";
const os={win32:"windows",darwin:"macos",linux:"linux"}[platform()];
const architecture={x64:"x64",arm64:"arm64"}[arch()];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function ensureUrl(){
 const u=new URL(endpoint);
 if(!["https:","http:"].includes(u.protocol))throw new Error("Unsupported controller scheme");
 if(u.protocol==="http:"&&!["127.0.0.1","localhost","portal","controller"].includes(u.hostname)&&process.env.MAIN_ALLOW_INSECURE_LAN!=="true")
  throw new Error("Use HTTPS for remote controller or explicitly permit isolated LAN HTTP");
 return u;
}
async function post(route,obj,token){
 const origin=ensureUrl(),url=new URL(route,origin);
 if(url.origin!==origin.origin)throw new Error("Cross-origin controller URL rejected");
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",
  ...(token?{authorization:"Bearer "+token}:{})},body:JSON.stringify(obj),signal:AbortSignal.timeout(30000)});
 const data=await response.json().catch(()=>({error:"Unexpected controller response"}));
 if(!response.ok)throw new Error("Controller HTTP "+response.status+" ("+(data.error||"request rejected")+")");
 return data;
}
async function enroll(){
 if(!os||!architecture)throw new Error("Unsupported runner platform or architecture");
 const invite=process.env.MAIN_ENROLLMENT_TOKEN||"";
 if(invite.length<32)throw new Error("MAIN_ENROLLMENT_TOKEN required for enrollment");
 const name=(process.env.MAIN_RUNNER_NAME||hostname()).slice(0,64);
 const r=await post("/api/agent/enroll",{token:invite,name,os,arch:architecture});
 mkdirSync(configDir,{recursive:true,mode:0o700});
 writeFileSync(path,JSON.stringify({id:r.id,token:r.token,url:endpoint,name,os,arch:architecture},null,2),{mode:0o600});
 chmodSync(path,0o600);
 console.log("Enrolled "+name+" ("+r.id+") to "+endpoint+". Execution requires explicit controller and runner opt-in.");
}
function approvedCheckout(repo){
 if(process.env.MAIN_RUNNER_ENABLE_BUILDS!=="1")throw new Error("Runner builds disabled by operator");
 let projects;
 try{projects=JSON.parse(process.env.MAIN_RUNNER_PROJECTS_JSON||"{}");}
 catch{throw new Error("Invalid MAIN_RUNNER_PROJECTS_JSON");}
 if(!projects||typeof projects!=="object"||Array.isArray(projects)||
  !Object.hasOwn(projects,repo)||typeof projects[repo]!=="string")
  throw new Error("Repository not in this runner's approved local project map");
 const dir=projects[repo];
 if(!isAbsolute(dir))throw new Error("Project checkout must be an absolute path");
 const actual=realpathSync(resolve(dir));
 if(!statSync(actual).isDirectory())throw new Error("Checkout is not a directory");
 return actual;
}
async function processTool(bin,args,cwd,timeoutMs,env={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,args,{cwd,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,...env}});
  let combined="",wasKilled=false;
  const capture=chunk=>{combined+=(chunk?.toString("utf8")||"");if(combined.length>20000)combined=combined.slice(-20000);};
  child.stdout.on("data",capture);child.stderr.on("data",capture);
  const timer=setTimeout(()=>{wasKilled=true;child.kill("SIGKILL");},timeoutMs);
  child.once("error",e=>{clearTimeout(timer);reject(new Error("Approved command failed: "+e.message));});
  child.once("close",code=>{clearTimeout(timer);
   if(wasKilled)return reject(new Error("Approved command timed out"));
   if(code!==0)return reject(new Error("Approved command failed (exit "+code+"): "+combined.slice(-4000)));
   resolve(combined);
  });
 });
}
async function uploadAsset(config,jobId,name,mime,data){
 if(!Buffer.isBuffer(data))data=Buffer.from(data);
 if(data.length<1||data.length>128*1024*1024)throw new Error("Artifact outside allowed size");
 const base={id:config.id,job_id:jobId};
 const begin=await post("/api/agent/assets",{...base,action:"begin",name,mime,size:data.length},config.token);
 const id=begin.asset.id,chunkSize=Math.min(48*1024,begin.max_chunk_bytes||48*1024);
 for(let off=0;off<data.length;off+=chunkSize){
  await post("/api/agent/assets",{...base,action:"chunk",asset_id:id,offset:off,
   content_base64:data.subarray(off,off+chunkSize).toString("base64")},config.token);
 }
 const digest=createHash("sha256").update(data).digest("hex");
 await post("/api/agent/assets",{...base,action:"finish",asset_id:id,sha256:digest},config.token);
 return id;
}
async function downloadAsset(config,jobId,assetId){
 if(!/^[a-f0-9]{32}$/.test(assetId))throw new Error("Invalid source artifact ID");
 const chunks=[];let offset=0,meta=null;
 for(let i=0;i<3000;i++){
  const part=await post("/api/agent/assets",{id:config.id,job_id:jobId,action:"download",asset_id:assetId,offset,length:48*1024},config.token);
  if(!meta)meta=part.asset;
  if(!part||part.offset!==offset||typeof part.content_base64!=="string")throw new Error("Invalid artifact download response");
  const data=Buffer.from(part.content_base64,"base64");
  if(!data.length||offset+data.length>128*1024*1024)throw new Error("Artifact exceeds transfer limits");
  chunks.push(data);offset+=data.length;
  if(part.complete)break;
  if(i===2999)throw new Error("Artifact transfer exceeded chunk limit");
 }
 const data=Buffer.concat(chunks);
 if(!meta||data.length!==meta.size||createHash("sha256").update(data).digest("hex")!==meta.sha256)
  throw new Error("Downloaded artifact size or SHA-256 does not match the completed build");
 const dir=join(configDir,"artifacts");mkdirSync(dir,{recursive:true,mode:0o700});
 const file=join(dir,assetId+"-"+meta.name);writeFileSync(file,data,{mode:0o600});
 return {file,asset:meta};
}
async function findAdb(){
 const output=(await processTool("bash",["-lc","command -v adb"],process.cwd(),10000)).trim();
 if(!output.startsWith("/"))throw new Error("ADB executable not found on this deployment runner");
 await processTool(output,["version"],process.cwd(),10000);
 return output;
}
async function authorizedAndroidDevice(adb,serial,expectedApi=22){
 if(typeof serial!=="string"||serial.length<3||serial.length>128||/[\\s\\x00-\\x1f]/.test(serial))
  throw new Error("An exact ADB device serial is required");
 const listing=await processTool(adb,["devices","-l"],process.cwd(),15000);
 const row=listing.split(/\\r?\\n/).find(line=>line.startsWith(serial+"\\t")||line.startsWith(serial+" "));
 if(!row||!/\\sdevice(?:\\s|$)/.test(row))throw new Error("The selected Android device is not connected and ADB-authorized");
 const readProp=async key=>(await processTool(adb,["-s",serial,"shell","getprop",key],process.cwd(),15000)).trim();
 const api=await readProp("ro.build.version.sdk");
 if(expectedApi!==null&&api!==String(expectedApi))throw new Error("Android API mismatch: expected "+expectedApi+", observed "+api);
 const abi=await readProp("ro.product.cpu.abi");
 if(expectedApi===22&&abi!=="armeabi-v7a")throw new Error("Legacy E Ink target ABI mismatch: "+abi);
 return {serial,api,abi,release:await readProp("ro.build.version.release")};
}
function gatherFirmware(dir){
 const build=join(dir,"build"),items=[];
 try{
  for(const name of readdirSync(build)){
   if(!name.endsWith(".bin")||!/^[A-Za-z0-9_.-]+\.bin$/.test(name))continue;
   const file=realpathSync(join(build,name));
   if(!file.startsWith(realpathSync(build)+sep))continue;
   const stat=statSync(file);if(!stat.isFile()||stat.size<1||stat.size>128*1024*1024)continue;
   items.push({name,data:readFileSync(file)});
   if(items.length>=5)break;
  }
 }catch(e){if(e.code!=="ENOENT")throw e;}
 return items;
}
function firmwareFiles(root,names){
 const files=[];
 for(const name of [...new Set(["flasher_args.json",...names])].sort()){
  if(typeof name!=="string"||name.startsWith("/")||name.split("/").includes("..")||name.includes("\\\\"))throw new Error("Unsafe firmware file path");
  const absolute=join(root,name),actual=realpathSync(absolute);
  if(!actual.startsWith(realpathSync(root)+sep)||!lstatSync(actual).isFile())throw new Error("Firmware bundle file is not a regular file");
  const data=readFileSync(actual);if(data.length>32*1024*1024)throw new Error("Firmware file exceeds bundle limits");
  files.push({name,sha256:createHash("sha256").update(data).digest("hex"),size:data.length});
 }
 return files;
}
function verifyFirmwareFiles(root,files){
 if(!Array.isArray(files)||!files.length||files.length>5000)throw new Error("Invalid firmware file manifest");
 for(const item of files){
  if(typeof item.name!=="string"||item.name.startsWith("/")||item.name.split("/").includes("..")||item.name.includes("\\\\"))
   throw new Error("Unsafe firmware file manifest entry");
  const file=join(root,item.name),actual=realpathSync(file);
  if(!actual.startsWith(realpathSync(root)+sep)||!statSync(actual).isFile())throw new Error("Firmware bundle file escaped its root");
  const data=readFileSync(actual);
  if(data.length!==item.size||createHash("sha256").update(data).digest("hex")!==item.sha256)
   throw new Error("Firmware bundle file integrity check failed: "+item.name);
 }
}
async function createFirmwareBundle(config,job,checkout,version,chip,revision){
 const build=join(checkout,"build"),flasher=JSON.parse(readFileSync(join(build,"flasher_args.json"),"utf8"));
 const parsed=validateFlasherArgs(flasher,build),names=parsed.files.map(x=>x.file.slice(realpathSync(build).length+1));
 const files=firmwareFiles(build,names);
 const stage=mkdtempSync(join(configDir,"firmware-bundle-")),payload=join(stage,"payload"),buildPayload=join(payload,"build");
 mkdirSync(buildPayload,{recursive:true,mode:0o700});
 for(const item of files){const target=join(buildPayload,item.name);mkdirSync(dirname(target),{recursive:true,mode:0o700});cpSync(join(build,item.name),target);}
 const manifest={kind:"maincreate-esp-idf-firmware-bundle",toolkitVersion:version,targetChip:chip,
  sourceRevision:revision,createdAt:new Date().toISOString(),files,bundleSha256:createHash("sha256").update(JSON.stringify(files)).digest("hex")};
 writeFileSync(join(payload,"maincreate-manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600});
 const archive=join(stage,"firmware-bundle.tar.gz");
 await processTool("tar",["-czf",archive,"-C",payload,"."],payload,5*60*1000);
 const data=readFileSync(archive);if(data.length>128*1024*1024)throw new Error("Firmware bundle exceeds transfer limit");
 const id=await uploadAsset(config,job.id,"firmware-bundle.tar.gz","application/gzip",data);
 rmSync(stage,{recursive:true,force:true});
 return {assetId:id,manifest};
}
async function extractFirmwareBundle(file,version,chip){
 const stage=mkdtempSync(join(configDir,"firmware-flash-"));
 const listing=await processTool("tar",["-tzf",file],stage,60000);
 const names=listing.split(/\\r?\\n/).filter(Boolean);
 if(!names.length||names.length>5000||names.some(n=>n.startsWith("/")||n.split("/").includes("..")||n.includes("\\\\")))
  throw new Error("Firmware archive contains unsafe paths");
 const verbose=await processTool("tar",["-tvzf",file],stage,60000);
 if(verbose.split(/\\r?\\n/).some(line=>/^[lh]/.test(line)))throw new Error("Firmware archive contains links");
 await processTool("tar",["-xzf",file,"-C",stage,"--no-same-owner","--no-same-permissions"],stage,5*60*1000);
 const root=stage,manifest=JSON.parse(readFileSync(join(root,"maincreate-manifest.json"),"utf8"));
 validateFirmwareManifest(manifest,{version,chip});
 verifyFirmwareFiles(join(root,"build"),manifest.files);
 const flasher=JSON.parse(readFileSync(join(root,"build","flasher_args.json"),"utf8"));
 const parsed=validateFlasherArgs(flasher,join(root,"build"));
 return {stage,root,build:join(root,"build"),manifest,parsed};
}
async function espTool(exportScript,port,args,timeout=5*60*1000){
 return processTool("bash",["-lc",'source "$1" >/dev/null && esptool --port "$2" "${@:3}"',"maincreate",exportScript,port,...args],process.cwd(),timeout);
}
async function probeEspDevice(exportScript,port,expectedChip){
 const chipOutput=await espTool(exportScript,port,["chip-id"],60000);
 const normalized=chipOutput.toLowerCase().replace(/[-_\\s]/g,"");
 if(!normalized.includes(expectedChip.toLowerCase().replace(/[-_\\s]/g,"")))
  throw new Error("Connected ESP chip does not match expected target: "+chipOutput.slice(-1200));
 const macOutput=await espTool(exportScript,port,["read-mac"],60000);
 const mac=macOutput.match(/(?:MAC|MAC address)[:\\s]+([0-9a-f:]{17})/i)?.[1]?.toLowerCase();
 if(!mac)throw new Error("Unable to obtain a stable ESP chip MAC identity");
 const flashOutput=await espTool(exportScript,port,["flash-id"],60000);
 const match=flashOutput.match(/Detected flash size:\\s*(\\d+)\\s*(KB|MB)/i);
 if(!match)throw new Error("Unable to detect ESP flash size");
 const flashBytes=Number(match[1])*(match[2].toUpperCase()==="MB"?1024*1024:1024);
 if(!Number.isSafeInteger(flashBytes)||flashBytes<1024*1024||flashBytes>64*1024*1024)throw new Error("Detected ESP flash size outside supported backup range");
 return {mac,chip:expectedChip,flashBytes,flashOutput};
}
function validatePort(port){if(typeof port!=="string"||!/^\\/dev\\/(ttyUSB|ttyACM)[0-9]+$/.test(port))throw new Error("Select an exact Linux USB serial port");return port;}
async function executeJob(config,job){
 const results=[],out=[],ids=[],steps=job.steps||[];
 let failed=false;
 for(const step of steps){
  if(failed){results.push({capability:step.capability,status:"skipped"});continue;}
  try{
   if(step.capability==="host.snapshot"){
    const report={host:config.name,os,architecture,hostname:hostname(),cpus:cpus().length,
     totalMemoryBytes:totalmem(),freeMemoryBytes:freemem(),uptimeSeconds:Math.floor(uptime()),
     node:process.version,observedAt:new Date().toISOString()};
    out.push("Host snapshot recorded");
    ids.push(await uploadAsset(config,job.id,"host-snapshot.json","application/json",
     Buffer.from(JSON.stringify(report,null,2))));
   }else if(step.capability==="toolkit.cleanup"){
    const family=job.parameters?.family,version=job.parameters?.version,dryRun=job.parameters?.dry_run!=="false";
    const valid=(family==="esp-idf"&&["5.5.6","6.1.1"].includes(version))||
      (family==="android-sdk"&&version==="2026.2.2-patch1");
    if(!valid)throw new Error("Unsupported toolkit cleanup selection");
    const result=await cleanupToolkit({family,version,dryRun,activeJobs:[]});
    out.push((dryRun?"Cleanup dry-run":"Toolkit removed")+": "+family+" "+version+"; path "+result.path+"; existed "+result.exists);
   }else if(step.capability==="toolkit.esp_idf.install"){
    if(process.env.MAIN_RUNNER_ENABLE_SDK_INSTALLS!=="1")throw new Error("Toolkit installation disabled by operator opt-in");
    const version=job.parameters?.version;
    const installed=await installEspIdf({version,os,architecture});
    out.push("Installed ESP-IDF "+installed.version+" on "+installed.path+"; EIM "+installed.eimVersion+"; SHA-256 "+installed.sha256);
   }else if(step.capability==="toolkit.android.install"){
    if(process.env.MAIN_RUNNER_ENABLE_SDK_INSTALLS!=="1")throw new Error("Toolkit installation disabled by operator opt-in");
    const accepted=job.parameters?.license_accepted==="true";
    const installed=await installAndroidSdk({os,architecture,acceptLicenses:accepted});
    out.push("Installed Android SDK "+installed.version+" on "+installed.path+"; SHA-256 "+installed.sha256);
   }else if(step.capability==="firmware.esp_idf.build"){
    const repo=job.parameters?.repository,version=job.parameters?.toolkit_version;
    if(typeof repo!=="string"||!["5.5.6","6.1.1"].includes(version))throw new Error("Repository and exact marketplace ESP-IDF version are required");
    const checkout=approvedCheckout(repo);
    if(typeof job.parameters?.revision!=="string"||!/^[a-f0-9]{40}$/i.test(job.parameters.revision))
     throw new Error("An exact Git revision must be approved before building");
    const actual=(await processTool("git",["rev-parse","HEAD"],checkout,20000)).trim();
    if(actual.toLowerCase()!==job.parameters.revision.toLowerCase())
     throw new Error("Checkout revision differs from approved plan; update the checkout separately");
    const dirty=(await processTool("git",["status","--porcelain=v1","--untracked-files=normal"],checkout,20000)).trim();
    if(dirty)throw new Error("Approved checkout has modified or untracked files; use a clean pinned checkout");
    const installed=await inspectInstalledToolkit({family:"esp-idf",version});
    if(!installed.installed)throw new Error("Selected ESP-IDF "+version+" is not installed and verified on this builder");
    const output=await processTool("bash",["-lc",'source "$1" >/dev/null && test "$(idf.py --version)" = "$2" && idf.py -C "$3" build',"maincreate",installed.exportScript,"ESP-IDF v"+version,checkout],
     checkout,30*60*1000);
    out.push(output.slice(-14000));
    ids.push(await uploadAsset(config,job.id,"esp-idf-build-log.txt","text/plain",Buffer.from(output||"Build completed")));
    const chip=String(job.parameters?.target_chip||"").toLowerCase().replace(/-/g,"");
    const configText=readFileSync(join(checkout,"sdkconfig"),"utf8");
    const configuredChip=configText.match(/^CONFIG_IDF_TARGET="([^"]+)"$/m)?.[1]?.toLowerCase().replace(/-/g,"");
    if(!chip||configuredChip!==chip)throw new Error("Project sdkconfig target does not match the approved ESP32 chip");
    const bundle=await createFirmwareBundle(config,job,checkout,version,chip,job.parameters.revision);
    out.push("Created firmware bundle "+bundle.assetId+" for "+chip+" with "+bundle.manifest.files.length+" verified files");
   }else if(step.capability==="firmware.esp_idf.flash"){
    if(!["5.5.6","6.1.1"].includes(job.parameters?.toolkit_version))throw new Error("Exact ESP-IDF toolkit version required");
    const version=job.parameters.toolkit_version,chip=String(job.parameters?.target_chip||"").toLowerCase().replace(/-/g,"");
    const port=job.parameters?.port;
    if(!/^\\/dev\\/(ttyUSB|ttyACM)[0-9]+$/.test(port||""))throw new Error("Select an exact Linux USB serial port");
    const installed=await inspectInstalledToolkit({family:"esp-idf",version});
    if(!installed.installed)throw new Error("Selected ESP-IDF version is not installed on deployment runner");
    const downloaded=await downloadAsset(config,job.id,job.parameters?.source_asset_id);
    if(downloaded.asset.name!=="firmware-bundle.tar.gz")throw new Error("Expected a Main{Create} firmware bundle");
    const bundle=await extractFirmwareBundle(downloaded.file,version,chip);
    const probe=await processTool("bash",["-lc",'source "$1" >/dev/null && esptool --port "$2" chip-id',"maincreate",installed.exportScript,port],process.cwd(),60000);
    const detected=probe.toLowerCase().replace(/[-_\\s]/g,"");
    if(!detected.includes(chip))throw new Error("Connected chip does not match selected firmware target: "+probe.slice(-1500));
    const args=["--port",port,"--chip",chip,"write-flash",...bundle.parsed.writeFlashArgs];
    for(const item of bundle.parsed.files)args.push("0x"+item.address.toString(16),item.file);
    const flashOutput=await processTool("bash",["-lc",'source "$1" >/dev/null && shift && esptool "$@"',"maincreate",installed.exportScript,...args],process.cwd(),15*60*1000);
    out.push("Firmware flashed to verified "+chip+" on "+port+": "+flashOutput.slice(-5000));
    rmSync(bundle.stage,{recursive:true,force:true});
   }else if(step.capability==="android.app.build"){
    const repo=job.parameters?.repository,version=job.parameters?.toolkit_version;
    if(typeof repo!=="string"||version!=="2026.2.2-patch1")throw new Error("Repository and exact Android SDK version are required");
    const checkout=approvedCheckout(repo);
    if(typeof job.parameters?.revision!=="string"||!/^[a-f0-9]{40}$/i.test(job.parameters.revision))throw new Error("Exact Git revision required");
    const actual=(await processTool("git",["rev-parse","HEAD"],checkout,20000)).trim();
    if(actual.toLowerCase()!==job.parameters.revision.toLowerCase())throw new Error("Checkout revision differs from approved plan");
    const dirty=(await processTool("git",["status","--porcelain=v1","--untracked-files=normal"],checkout,20000)).trim();
    if(dirty)throw new Error("Approved checkout must be clean");
    const installed=await inspectInstalledToolkit({family:"android-sdk",version});
    if(!installed.installed)throw new Error("Selected Android SDK is not installed and verified");
    const wrapperProperties=join(checkout,"gradle","wrapper","gradle-wrapper.properties");
    if(!statSync(wrapperProperties).isFile())throw new Error("Pinned Gradle wrapper properties are missing");
    const wrapperConfig=readFileSync(wrapperProperties,"utf8");
    const distribution=wrapperConfig.match(/^distributionUrl\\s*=\\s*(.+)$/m)?.[1]?.trim().replaceAll("\\\\:",":");
    const checksum=wrapperConfig.match(/^distributionSha256Sum\\s*=\\s*([a-fA-F0-9]{64})$/m)?.[1];
    if(!/^https:\\/\\/services\\.gradle\\.org\\/distributions\\/gradle-9\\.6\\.0-(bin|all)\\.zip$/.test(distribution||"")||!checksum)
     throw new Error("Gradle wrapper must use an HTTPS official Gradle distribution with a pinned SHA-256");
    const gradle=join(checkout,"gradlew");
    if(!statSync(gradle).isFile())throw new Error("Project Gradle wrapper is missing");
    const task="assembleDebug";
    const output=await processTool("bash",[gradle,"--no-daemon",task],checkout,45*60*1000,{ANDROID_HOME:installed.sdkRoot,ANDROID_SDK_ROOT:installed.sdkRoot});
    out.push(output.slice(-14000));
    const apkRoot=join(checkout,"app","build","outputs","apk");
    const apks=[];
    function collect(dir,depth=0){if(depth>6)return;for(const name of readdirSync(dir,{withFileTypes:true})){const p=join(dir,name.name);if(name.isDirectory())collect(p,depth+1);else if(name.isFile()&&name.name.endsWith(".apk"))apks.push(p);}}
    collect(apkRoot);
    if(apks.length!==1)throw new Error("Android build must produce exactly one APK for this deployment profile; found "+apks.length);
    const aapt2=join(installed.sdkRoot,"build-tools","36.0.0","aapt2");
    const expectedApi=job.parameters?.target_profile==="android-legacy-api22-eink"?"22":"37";
    const file=apks[0],badging=await processTool(aapt2,["dump","badging",file],checkout,30000);
    const packageName=badging.match(/^package: name='([^']+)'/m)?.[1];
    if(!packageName||!/^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName))
     throw new Error("Unable to identify a valid Android application package name");
    if(!badging.includes("sdkVersion:'"+expectedApi+"'")||!badging.includes("targetSdkVersion:'"+expectedApi+"'"))
     throw new Error("APK minSdk/targetSdk does not match selected Android API "+expectedApi);
    if(expectedApi==="22"&&/native-code:/.test(badging)&&!badging.includes("native-code: 'armeabi-v7a'"))
     throw new Error("Legacy E Ink APK contains native libraries without armeabi-v7a");
    const data=readFileSync(file),stage=mkdtempSync(join(configDir,"android-app-bundle-"));
    const apkName="application.apk";writeFileSync(join(stage,apkName),data,{mode:0o600});
    const manifest={kind:"maincreate-android-app-bundle",toolkitVersion:version,targetProfile:job.parameters.target_profile,
     packageName,minSdk:Number(expectedApi),targetSdk:Number(expectedApi),
     nativeAbis:(badging.match(/^native-code: (.+)$/m)?.[1]||"").replaceAll("'","").trim().split(/\\s+/).filter(Boolean),
     apkName,apkSha256:createHash("sha256").update(data).digest("hex"),sourceRevision:job.parameters.revision,
     createdAt:new Date().toISOString()};
    writeFileSync(join(stage,"manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600});
    const archive=join(stage,"android-app-bundle.tar.gz");
    await processTool("tar",["-czf",archive,"-C",stage,apkName,"manifest.json"],stage,5*60*1000);
    ids.push(await uploadAsset(config,job.id,"android-app-bundle.tar.gz","application/gzip",readFileSync(archive)));
    rmSync(stage,{recursive:true,force:true});
    ids.push(await uploadAsset(config,job.id,"android-build-log.txt","text/plain",Buffer.from(output||"Build completed")));
   }else if(step.capability==="firmware.esp_idf.backup"){
    const version=job.parameters?.toolkit_version,chip=String(job.parameters?.target_chip||"").toLowerCase().replace(/-/g,"");
    if(!["5.5.6","6.1.1"].includes(version)||!chip)throw new Error("Exact ESP-IDF version and target chip are required");
    const port=validatePort(job.parameters?.port),installed=await inspectInstalledToolkit({family:"esp-idf",version});
    if(!installed.installed)throw new Error("Selected ESP-IDF version is not installed");
    const device=await probeEspDevice(installed.exportScript,port,chip);
    const security=await espTool(installed.exportScript,port,["get-security-info"],60000);
    if(/flash.?encryption[^\\n]*(?:enabled|true)|secure.?boot[^\\n]*(?:enabled|true)/i.test(security))
     throw new Error("Refusing raw flash backup while flash encryption or secure boot is enabled");
    const offset=Number.parseInt(job.parameters?.partition_table_offset||"0x8000");
    if(!Number.isSafeInteger(offset)||offset<0||offset>device.flashBytes-4096)throw new Error("Invalid partition table offset");
    const dir=mkdtempSync(join(configDir,"esp-backup-")),image=join(dir,"flash.bin");
    await espTool(installed.exportScript,port,["read-flash","0","ALL",image],15*60*1000);
    const data=readFileSync(image);if(data.length!==device.flashBytes)throw new Error("Flash readback size differs from detected flash size");
    const partition=data.subarray(offset,offset+0xC00);
    const manifest={kind:"maincreate-esp32-flash-backup",chip,mac:device.mac,flashBytes:device.flashBytes,
     partitionTableOffset:offset,partitionTableSha256:createHash("sha256").update(partition).digest("hex"),
     imageSha256:createHash("sha256").update(data).digest("hex"),createdAt:new Date().toISOString(),
     securityInfo:security.slice(0,4000)};
    writeFileSync(join(dir,"manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600});
    const archive=join(dir,"esp32-flash-backup.tar.gz");
    await processTool("tar",["-czf",archive,"-C",dir,"flash.bin","manifest.json"],dir,5*60*1000);
    const id=await uploadAsset(config,job.id,"esp32-flash-backup.tar.gz","application/gzip",readFileSync(archive));
    out.push("Created full flash backup for "+device.mac+" ("+device.flashBytes+" bytes); security state checked. Private flash data is not exported.");
    ids.push(id);rmSync(dir,{recursive:true,force:true});
   }else if(step.capability==="firmware.esp_idf.restore"){
    const version=job.parameters?.toolkit_version,chip=String(job.parameters?.target_chip||"").toLowerCase().replace(/-/g,"");
    if(!["5.5.6","6.1.1"].includes(version)||!chip)throw new Error("Exact ESP-IDF version and target chip are required");
    const port=validatePort(job.parameters?.port),installed=await inspectInstalledToolkit({family:"esp-idf",version});
    if(!installed.installed)throw new Error("Selected ESP-IDF version is not installed");
    const downloaded=await downloadAsset(config,job.id,job.parameters?.source_asset_id);
    if(downloaded.asset.name!=="esp32-flash-backup.tar.gz")throw new Error("Expected an ESP32 flash backup archive");
    const dir=mkdtempSync(join(configDir,"esp-restore-"));
    const listing=await processTool("tar",["-tzf",downloaded.file],dir,60000);
    const names=listing.split(/\\r?\\n/).filter(Boolean);
    if(names.length!==2||names.some(n=>!["flash.bin","manifest.json"].includes(n)))throw new Error("Unexpected ESP32 backup archive contents");
    await processTool("tar",["-xzf",downloaded.file,"-C",dir,"--no-same-owner","--no-same-permissions"],dir,60000);
    const manifest=JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8")),data=readFileSync(join(dir,"flash.bin"));
    if(manifest.kind!=="maincreate-esp32-flash-backup"||manifest.chip!==chip||data.length!==manifest.flashBytes||
       createHash("sha256").update(data).digest("hex")!==manifest.imageSha256)
     throw new Error("ESP32 backup manifest, chip family or image checksum is invalid");
    const device=await probeEspDevice(installed.exportScript,port,chip);
    if(device.mac!==manifest.mac||device.flashBytes!==manifest.flashBytes)throw new Error("Restore target must be the exact source chip with matching flash size");
    const offset=manifest.partitionTableOffset,partition=data.subarray(offset,offset+0xC00);
    if(createHash("sha256").update(partition).digest("hex")!==manifest.partitionTableSha256)throw new Error("Backup partition table integrity check failed");
    const current=join(dir,"current-partition.bin");
    await espTool(installed.exportScript,port,["read-flash","0x"+offset.toString(16),"0xC00",current],120000);
    if(createHash("sha256").update(readFileSync(current)).digest("hex")!==manifest.partitionTableSha256)
     throw new Error("Target partition layout differs from backup; restore refused");
    const output=await espTool(installed.exportScript,port,["write-flash","--flash-size","detect","0x0",join(dir,"flash.bin")],15*60*1000);
    out.push("Restored full flash image to exact source ESP32 "+device.mac+": "+output.slice(-2500));
    rmSync(dir,{recursive:true,force:true});
   }else if(step.capability==="android.app.deploy"||step.capability==="android.app.restore"){
    const profile=job.parameters?.device_profile||"avalue-epd-42s";
    if(profile!=="avalue-epd-42s")throw new Error("Unknown Android device profile");
    const adb=await findAdb(),device=await authorizedAndroidDevice(adb,job.parameters?.device_serial,22);
    const packageName=job.parameters?.package_name||"";
    if(!/^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName))throw new Error("Valid Android package name is required");
    const downloaded=await downloadAsset(config,job.id,job.parameters?.source_asset_id);
    let apkPath=downloaded.file,bundleDir=null;
    if(downloaded.asset.name==="android-app-bundle.tar.gz"){
     bundleDir=mkdtempSync(join(configDir,"android-app-deploy-"));
     const listing=await processTool("tar",["-tzf",downloaded.file],bundleDir,30000);
     const names=listing.split(/\\r?\\n/).filter(Boolean);
     if(names.length!==2||names.some(n=>!["application.apk","manifest.json"].includes(n)))throw new Error("Unexpected Android app bundle contents");
     const verbose=await processTool("tar",["-tvzf",downloaded.file],bundleDir,30000);
     if(verbose.split(/\\r?\\n/).some(line=>/^[lh]/.test(line)))throw new Error("Android app bundle contains links");
     await processTool("tar",["-xzf",downloaded.file,"-C",bundleDir,"--no-same-owner","--no-same-permissions"],bundleDir,30000);
     const manifest=JSON.parse(readFileSync(join(bundleDir,"manifest.json"),"utf8"));
     apkPath=join(bundleDir,"application.apk");
     const apk=readFileSync(apkPath);
     if(manifest.kind!=="maincreate-android-app-bundle"||manifest.packageName!==packageName||
       manifest.targetProfile!=="android-legacy-api22-eink"||manifest.minSdk!==22||manifest.targetSdk!==22||
       createHash("sha256").update(apk).digest("hex")!==manifest.apkSha256||
       (manifest.nativeAbis?.length&&!manifest.nativeAbis.includes("armeabi-v7a")))
      throw new Error("Android app manifest does not match the selected API22 E Ink target or package");
    }else if(!downloaded.asset.name.endsWith(".apk")||step.capability!=="android.app.restore"){
     throw new Error("Android deployment requires a verified app bundle; raw APKs are accepted only for restore");
    }
    const output=await processTool(adb,["-s",device.serial,"install","-r",apkPath],process.cwd(),5*60*1000);
    const installed=await processTool(adb,["-s",device.serial,"shell","pm","path",packageName],process.cwd(),30000);
    if(!installed.includes("package:"))throw new Error("APK installation returned success but package verification failed");
    out.push("Installed "+packageName+" on Android "+device.release+" API "+device.api+" ("+device.abi+"): "+output.slice(-3000));
    if(bundleDir)rmSync(bundleDir,{recursive:true,force:true});
   }else if(step.capability==="android.app.backup"){
    const adb=await findAdb(),device=await authorizedAndroidDevice(adb,job.parameters?.device_serial,22);
    const packageName=job.parameters?.package_name||"";
    if(!/^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName))throw new Error("Valid Android package name is required");
    const paths=await processTool(adb,["-s",device.serial,"shell","pm","path",packageName],process.cwd(),30000);
    const remote=paths.split(/\\r?\\n/).map(x=>x.trim().replace(/^package:/,"")).find(x=>x.startsWith("/data/app/")&&x.endsWith(".apk"));
    if(!remote)throw new Error("Installed base APK is not readable on this Android build");
    const dir=join(configDir,"artifacts");mkdirSync(dir,{recursive:true,mode:0o700});
    const local=join(dir,job.id+"-"+packageName.replace(/[^A-Za-z0-9_.-]/g,"_")+".apk");
    await processTool(adb,["-s",device.serial,"pull",remote,local],process.cwd(),5*60*1000);
    const data=readFileSync(local);
    const id=await uploadAsset(config,job.id,packageName.replace(/[^A-Za-z0-9_.-]/g,"_")+".apk","application/vnd.android.package-archive",data);
    out.push("Backed up installed APK for "+packageName+" from Android API "+device.api+" ("+device.abi+"). Private application data is not included.");
    ids.push(id);
   }else if(step.capability==="sdk.arduino_cli.install"){
    if(process.env.MAIN_RUNNER_ENABLE_SDK_INSTALLS!=="1")throw new Error("SDK installation adapter disabled by operator opt-in");
    const installed=await installArduinoCli({os,architecture:architecture});
    out.push("Installed "+installed.family+" "+installed.version+" for "+installed.target+"; verified "+installed.sha256);
   }else throw new Error("Runner does not support capability "+step.capability);
   results.push({capability:step.capability,status:"completed"});
  }catch(e){
   failed=true;out.push("Step "+step.capability+" failed: "+e.message);
   results.push({capability:step.capability,status:"failed"});
  }
 }
 const logs=out.join("\n").slice(-24000);
 await post("/api/agent/jobs/complete",{id:config.id,job_id:job.id,success:!failed,
  logs,steps:results,asset_ids:ids},config.token);
 console.log("Job "+job.id+" "+(failed?"failed":"completed")+"; artifacts "+ids.length);
}
function linuxSerialDevices(){
 const devices=[];
 let ports=[];try{ports=readdirSync("/sys/class/tty");}catch{return devices;}
 for(const name of ports){
  if(!/^tty(?:USB|ACM)\d+$/.test(name))continue;
  try{
   let current=realpathSync(join("/sys/class/tty",name,"device"));
   let vid=null,pid=null,serialNumber=null,manufacturer=null,product=null;
   for(let i=0;i<9&&current.startsWith("/sys/");i++){
    try{
     const v=readFileSync(join(current,"idVendor"),"utf8").trim();
     const p=readFileSync(join(current,"idProduct"),"utf8").trim();
     if(/^[a-f0-9]{4}$/i.test(v)&&/^[a-f0-9]{4}$/i.test(p)){
      vid=parseInt(v,16);pid=parseInt(p,16);
      const read=n=>{try{return readFileSync(join(current,n),"utf8").trim().slice(0,120);}catch{return null;}};
      serialNumber=read("serial");manufacturer=read("manufacturer");product=read("product");break;
     }
    }catch{}
    const next=dirname(current);if(next===current)break;current=next;
   }
   if(vid!==null&&pid!==null)devices.push({port:"/dev/"+name,description:product||name,
     manufacturer,product,vid,pid,serialNumber,location:null,interface:null});
  }catch{}
 }
 return devices.slice(0,48);
}
async function scanSerialDevices(){
 if(os==="linux")return linuxSerialDevices();
 const python=process.env.MAIN_RUNNER_PYTHON||(os==="windows"?"python":"python3");
 const script=fileURLToPath(new URL("./scan_devices.py",import.meta.url));
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[script],{shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let raw="",errors="";
  const cap=buffer=>String(buffer).slice(0,1024);
  child.stdout.on("data",chunk=>{raw+=String(chunk);if(raw.length>64*1024)child.kill("SIGKILL");});
  child.stderr.on("data",chunk=>errors+=cap(chunk));
  const timeout=setTimeout(()=>child.kill("SIGKILL"),12000);
  child.once("error",e=>{clearTimeout(timeout);reject(e);});
  child.once("close",code=>{
   clearTimeout(timeout);
   if(code!==0)return reject(new Error("USB discovery unavailable: "+(errors||raw).slice(0,180)));
   try{
    const result=JSON.parse(raw);
    if(!Array.isArray(result.devices))throw new Error("Invalid inventory output");
    resolve(result.devices);
   }catch(e){reject(e);}
  });
 });
}
async function detectPackages(){
 const candidates=[["node","node",["--version"]],["git","git",["--version"]],
  ["python3","python3",["--version"]],["cmake","cmake",["--version"]],
  ["gcc","gcc",["--version"]],["esp-idf","idf.py",["--version"]],
  ["swift","swift",["--version"]],["xcode","xcodebuild",["-version"]]];
 const packages=[];
 for(const [name,bin,args] of candidates){
  try{
   const output=await new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{shell:false,windowsHide:true,stdio:["ignore","pipe","ignore"]});
    let data="";const timer=setTimeout(()=>child.kill("SIGKILL"),3000);
    child.stdout.on("data",c=>{data+=String(c);if(data.length>2000)child.kill("SIGKILL");});
    child.once("error",e=>{clearTimeout(timer);reject(e);});
    child.once("close",code=>{clearTimeout(timer);code===0?resolve(data.trim()):reject(new Error("Tool unavailable"));});
   });
   packages.push({name,version:String(output.split(/\r?\n/)[0]||"installed").slice(0,90)});
 }catch{}
 }
 try{
  const cli=installedArduinoCli();
  const output=await new Promise((resolve,reject)=>{const child=spawn(cli,["version"],{shell:false,stdio:["ignore","pipe","ignore"]});let data="";const timer=setTimeout(()=>child.kill("SIGKILL"),3000);child.stdout.on("data",c=>data+=String(c));child.once("error",e=>{clearTimeout(timer);reject(e)});child.once("close",code=>{clearTimeout(timer);code===0&&isExactArduinoVersion(data)?resolve(data.trim()):reject(new Error("not exact Arduino CLI version"))})});
  packages.push({name:"arduino-cli",version:"1.5.1",path:cli,verified:true,source:"maincreate-per-user-sdk"});
 }catch{}
 for(const version of ["5.5.6","6.1.1"]){
  try{const found=await inspectInstalledToolkit({family:"esp-idf",version});if(found.installed)packages.push({name:"esp-idf",version,verified:true});}catch{}
 }
 try{const found=await inspectInstalledToolkit({family:"android-sdk",version:"2026.2.2-patch1"});if(found.installed)packages.push({name:"android-sdk",version:"2026.2.2-patch1",verified:true});}catch{}
 try{
  const output=await processTool("adb",["version"],process.cwd(),10000);
  packages.push({name:"adb",version:(output.split(/\\r?\\n/)[0]||"installed").slice(0,90)});
  const listing=await processTool("adb",["devices"],process.cwd(),10000);
  for(const line of listing.split(/\\r?\\n/).slice(1)){
   const match=line.match(/^([A-Za-z0-9._:-]{3,128})\\s+device$/);if(!match)continue;
   const serial=match[1];
   const api=(await processTool("adb",["-s",serial,"shell","getprop","ro.build.version.sdk"],process.cwd(),10000)).trim();
   const abi=(await processTool("adb",["-s",serial,"shell","getprop","ro.product.cpu.abi"],process.cwd(),10000)).trim();
   if(api==="22"&&abi==="armeabi-v7a"){packages.push({name:"android-device-api22",version:"connected"});break;}
  }
 }catch{}
 return packages;
}
async function run(){
 const config=JSON.parse(readFileSync(path,"utf8"));
 if(config.url!==endpoint)throw new Error("Controller URL does not match enrollment");
 console.log("Runner started: "+config.name+"; approved jobs only, no shell/flash actions");
 const heartbeat=setInterval(()=>{
  post("/api/agent/heartbeat",{id:config.id},config.token).catch(e=>console.error("Heartbeat:",e.message));
 },30000);
 try{
  let nextScan=0,nextPackageScan=0;
  for(;;){
   if(Date.now()>=nextPackageScan){
    nextPackageScan=Date.now()+300000;
    try{await post("/api/agent/heartbeat",{id:config.id,packages:await detectPackages()},config.token);}
    catch(e){console.error("Package inventory:",e.message);}
   }
   if(process.env.MAIN_RUNNER_DEVICE_DISCOVERY!=="0"&&Date.now()>=nextScan){
    nextScan=Date.now()+60000;
    try{
     const devices=await scanSerialDevices();
     const summary=await post("/api/agent/devices",{id:config.id,devices},config.token);
     console.log("Device inventory: "+summary.seen+" USB serial device(s) on "+config.name);
    }catch(e){console.error("Device inventory skipped (previous inventory preserved):",e.message);}
   }
   try{
    const response=await post("/api/agent/jobs/claim",{id:config.id},config.token);
    if(response.job)await executeJob(config,response.job);
   }catch(e){console.error("Runner polling:",e.message);}
   await sleep(10000);
  }
 }finally{clearInterval(heartbeat);}
}
try{
 if(command==="enroll")await enroll();
 else if(command==="run")await run();
 else throw new Error("Usage: node agent.mjs enroll|run");
}catch(e){console.error("Runner error:",e.message);process.exitCode=1;}
