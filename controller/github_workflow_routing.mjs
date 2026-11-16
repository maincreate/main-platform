/**
 * Deterministic GitHub Actions routing for versioned Main{Create} toolkit builds and device operations.
 * Generated workflows separate build artifacts from manually dispatched device writes.
 */
import {releases,classifyBuilderForOperation} from "./marketplace_planning.mjs";

const bad=(message,status=422)=>Object.assign(new Error(message),{status});
const githubName=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;
const ghHeaders=token=>({"authorization":"Bearer "+token,"accept":"application/vnd.github+json",
 "x-github-api-version":"2022-11-28","user-agent":"Main{Create}"});
export const labelForGithubRunnerId=id=>{
 if(!Number.isSafeInteger(id)||id<=0)throw bad("GitHub runner ID is invalid");
 return "maincreate-host-"+id;
};
const labelValid=s=>typeof s==="string"&&/^maincreate-host-\d+$/.test(s);
const findRunner=async({builder,organization,token,fetchImpl=fetch})=>{
 if(!githubName.test(builder?.githubRunnerName||""))throw bad("Connect this builder to a GitHub Actions runner first",409);
 if(typeof token!=="string"||token.length<20)throw bad("GitHub authorization is missing",409);
 const base="https://api.github.com/orgs/"+encodeURIComponent(organization)+"/actions/runners";
 let matching=null;
 for(let page=1;page<=5;page++){
  const response=await fetchImpl(base+"?per_page=100&page="+page,{headers:ghHeaders(token),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw bad("Cannot list GitHub organization runners (HTTP "+response.status+")",502);
  const json=await response.json();
  if(!Array.isArray(json.runners))throw bad("Invalid GitHub runner response",502);
  const found=json.runners.filter(r=>r.name===builder.githubRunnerName);
  if(found.length>1)throw bad("Ambiguous GitHub runner name",409);
  if(found.length===1){matching=found[0];break;}
  if(json.runners.length<100)break;
 }
 if(!matching||!Number.isSafeInteger(matching.id))throw bad("Connected GitHub runner not found in organization",409);
 if(matching.status!=="online")throw bad("Selected GitHub runner is offline",409);
 return {base,runner:matching};
};
export async function ensureRunnerLabel({builder,organization,token,fetchImpl=fetch}){
 const {base,runner}=await findRunner({builder,organization,token,fetchImpl});
 const label=labelForGithubRunnerId(runner.id),endpoint=base+"/"+runner.id+"/labels";
 const current=await fetchImpl(endpoint,{headers:ghHeaders(token),signal:AbortSignal.timeout(15000)});
 if(!current.ok)throw bad("Cannot inspect GitHub runner labels (HTTP "+current.status+")",502);
 const body=await current.json().catch(()=>({}));
 if(!Array.isArray(body.labels)||!body.labels.some(l=>l.name===label)){
  const response=await fetchImpl(endpoint,{method:"POST",headers:{...ghHeaders(token),"content-type":"application/json"},
   body:JSON.stringify({labels:[label]}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw bad("GitHub denied unique runner label provisioning (HTTP "+response.status+")",response.status===403?403:502);
  const added=await response.json().catch(()=>({}));
  if(!Array.isArray(added.labels)||!added.labels.some(l=>l.name===label))
   throw bad("GitHub did not confirm the unique runner label",502);
 }
 return {runnerId:runner.id,runnerName:runner.name,label,at:new Date().toISOString()};
}
function validState({route,project,builder,organization}){
 if(!route||!project||!builder||!organization)throw bad("Choose a saved, synchronized build route",409);
 if(route.organization!==organization||route.repository!==project.fullName||project.archived)
  throw bad("Routing must reference an active repository in the connected organization",409);
 if(!project.private)throw bad("Self-hosted builder workflows require a private repository or a separately isolated public-runner pool",403);
 if(!builder.managedHost||builder.decommission||route.buildBuilderId!==builder.id)
  throw bad("Selected build builder must be the enrolled managed host",409);
 if(!githubName.test(builder.githubRunnerName||""))throw bad("Connect this builder to a GitHub Actions runner before generating the workflow",409);
 if(route.buildTrigger!=="github-actions")throw bad("Choose GitHub Actions as the project's trigger");
 const release=releases().find(r=>r.family===route.sdk?.family&&r.version===route.sdk?.version);
 if(!release)throw bad("Select a published marketplace toolkit version");
 const build=classifyBuilderForOperation(builder,release,"build");
 if(!build.compatible)throw bad("The selected builder is not compatible with this toolkit build: "+build.reason,409);
 if(builder.os!=="linux")throw bad("The current Main{Create} reusable build workflows support Linux builders only",409);
 return release;
}
const toolkitLabel=release=>{
 const labels=release.operations?.build?.runnerLabels||[];
 const raw=labels.find(x=>x.startsWith("toolkit-"))||("toolkit-"+release.family+"-"+release.version.replaceAll(".","-"));
 return raw.startsWith("maincreate-")?raw:"maincreate-"+raw;
};
function projectWorkflow({route,release,buildLabel,deviceLabel,maincreateRef,defaultBranch}){
 const family=release.family,version=release.version,tkLabel=toolkitLabel(release),android=family==="android-sdk";
 const buildFile=android?"build-android.yml":"build-esp-idf.yml";
 const operationOptions=android?"[build, android-probe, android-install, android-backup, android-restore]":
  "[build, esp32-probe, esp32-flash, esp32-backup, esp32-restore]";
 const targetProfileId=route.targetProfile||(android?"android-legacy-api22-eink":"");
 const profile=android?release.deviceProfiles.find(p=>p.id===targetProfileId):null;
 const targetLabel=android?"maincreate-"+(profile?.runnerLabels?.find(x=>x.startsWith("target-android-api-"))||"target-android-api-22"):"";
 const buildInputs=[
  '      toolkit_version: "'+version+'"',
  '      build_runner_label: "'+buildLabel+'"',
  '      toolkit_label: "'+tkLabel+'"',
  ...(android?['      target_label: "'+targetLabel+'"']:[]),
  '      maincreate_ref: "'+maincreateRef+'"',
  ...(android?[
   '      target_profile: __DOLLAR__{{ inputs.target_profile || \'android-legacy-api22-eink\' }}',
   '      build_variant: __DOLLAR__{{ inputs.build_variant || \'debug\' }}'
  ]:[]),
  '      artifact_name: __DOLLAR__{{ inputs.artifact_name || format(\'maincreate-'+(android?'android':'esp-idf')+'-{0}\', github.sha) }}'
 ].join("\n");
 const inputLines=android?[
  "      operation:",
  "        description: Build or operate on an Android application",
  "        required: true",
  "        type: choice",
  "        options: "+operationOptions,
  "      target_profile:",
  "        description: Android runtime target for application builds",
  "        required: true",
  "        type: choice",
  "        options: [android-current-api37, android-legacy-api22-eink]",
  "        default: "+(route.targetProfile||"android-legacy-api22-eink"),
  "      build_variant:",
  "        description: Gradle APK variant",
  "        required: true",
  "        type: choice",
  "        options: [debug, release]",
  "        default: debug",
  "      artifact_run_id:",
  "        description: Prior build or backup workflow run ID (required for install/restore)",
  "        required: false",
  "        type: string",
  "      artifact_name:",
  "        description: Exact artifact name from that run",
  "        required: false",
  "        type: string",
  "      device_serial:",
  "        description: Exact serial from adb devices",
  "        required: false",
  "        type: string",
  "      package_name:",
  "        description: Android package name for application backup",
  "        required: false",
  "        type: string",
  "      confirm_device_write:",
  "        description: Explicitly authorize APK install or restore",
  "        required: false",
  "        type: boolean",
  "        default: false"
 ].join("\n"):[
  "      operation:",
  "        description: Build or operate on ESP32 firmware",
  "        required: true",
  "        type: choice",
  "        options: "+operationOptions,
  "      artifact_run_id:",
  "        description: Prior build or backup workflow run ID (required for flash/restore)",
  "        required: false",
  "        type: string",
  "      artifact_name:",
  "        description: Exact artifact name from that run",
  "        required: false",
  "        type: string",
  "      device_port:",
  "        description: USB serial port on the selected device builder",
  "        required: false",
  "        type: string",
  "        default: /dev/ttyUSB0",
  "      expected_chip_mac:",
  "        description: Expected ESP32 eFuse MAC from a successful probe",
  "        required: false",
  "        type: string",
  "      confirm_device_write:",
  "        description: Explicitly authorize flash or restore",
  "        required: false",
  "        type: boolean",
  "        default: false"
 ].join("\n");
 const deviceInputs=android?[
  "      operation: __DOLLAR__{{ inputs.operation }}",
  '      device_runner_label: "'+deviceLabel+'"',
  '      maincreate_ref: "'+maincreateRef+'"',
  "      artifact_run_id: __DOLLAR__{{ inputs.artifact_run_id }}",
  "      artifact_name: __DOLLAR__{{ inputs.artifact_name }}",
  "      device_serial: __DOLLAR__{{ inputs.device_serial }}",
  "      target_profile: __DOLLAR__{{ inputs.target_profile }}",
  "      package_name: __DOLLAR__{{ inputs.package_name }}",
  "      confirm_device_write: __DOLLAR__{{ inputs.confirm_device_write }}"
 ].join("\n"):[
  "      operation: __DOLLAR__{{ inputs.operation }}",
  '      device_runner_label: "'+deviceLabel+'"',
  '      toolkit_version: "'+version+'"',
  '      toolkit_label: "'+tkLabel+'"',
  '      maincreate_ref: "'+maincreateRef+'"',
  "      artifact_run_id: __DOLLAR__{{ inputs.artifact_run_id }}",
  "      artifact_name: __DOLLAR__{{ inputs.artifact_name }}",
  "      device_port: __DOLLAR__{{ inputs.device_port }}",
  "      expected_chip_mac: __DOLLAR__{{ inputs.expected_chip_mac }}",
  "      confirm_device_write: __DOLLAR__{{ inputs.confirm_device_write }}"
 ].join("\n");
 const lines=[
  "# Generated by Main{Create}. Review and commit this workflow in the private project repository.",
  "# Build and device operations are separate. Device writes require manual dispatch and explicit confirmation.",
  "name: Main{Create} "+(android?"Android application":"ESP32 firmware")+" pipeline",
  "",
  "on:",
  "  push:",
  "    branches: [" + defaultBranch + "]",
  "  workflow_dispatch:",
  "    inputs:",
  inputLines,
  "",
  "permissions:",
  "  contents: read",
  "  actions: write",
  "",
  "concurrency:",
  "  group: maincreate-"+family+"-"+version+"-__DOLLAR__{{ github.repository }}",
  "  cancel-in-progress: false",
  "",
  "jobs:",
  "  build:",
  "    if: github.event_name == 'push' || inputs.operation == 'build'",
  "    uses: maincreate/main-platform/.github/workflows/"+buildFile+"@"+maincreateRef,
  "    with:",
  buildInputs
 ];
 if(deviceLabel){
  lines.push("","  device-operation:","    if: github.event_name == 'workflow_dispatch' && inputs.operation != 'build'",
   "    uses: maincreate/main-platform/.github/workflows/device-operations.yml@"+maincreateRef,
   "    with:",deviceInputs);
 }
 return lines.join("\n").replaceAll("__DOLLAR__","$")+"\n";
}
export function firmwareWorkflowPreview({route,project,builder,organization,flashBuilder=null,maincreateRef="main"}){
 const release=validState({route,project,builder,organization});
 if(!/^maincreate-host-\d+$/.test(route.githubRunnerLabel||"")||
  !Number.isSafeInteger(route.githubRunnerId)||route.githubRunnerLabel!==labelForGithubRunnerId(route.githubRunnerId)||
  route.githubRunnerName!==builder.githubRunnerName)
  return {ready:false,reason:"Provision a unique GitHub runner label before generating the workflow",
   needsLabelProvisioning:true,workflow:null};
 if(!/^[A-Za-z0-9._/-]{1,80}$/.test(maincreateRef)||maincreateRef.includes(".."))
  throw bad("Invalid Main{Create} reusable workflow ref");
 const defaultBranch=project.defaultBranch||"main";
 if(!/^[A-Za-z0-9._/-]{1,100}$/.test(defaultBranch)||defaultBranch.includes(".."))
  throw bad("Invalid project default branch");
 let deviceLabel=null;
 if(route.flashBuilderId){
  if(!flashBuilder||!flashBuilder.managedHost||flashBuilder.decommission||!flashBuilder.githubRunnerName)
   throw bad("Select and register an online managed device-operation builder",409);
  if(flashBuilder.os!=="linux")throw bad("Device operations currently require a Linux builder",409);
  const deploy=classifyBuilderForOperation(flashBuilder,release,"deploy");
  if(!deploy.compatible)throw bad("Selected device builder is incompatible: "+deploy.reason,409);
  if(!/^maincreate-host-\d+$/.test(route.githubFlashRunnerLabel||"")||
   !Number.isSafeInteger(route.githubFlashRunnerId)||route.githubFlashRunnerLabel!==labelForGithubRunnerId(route.githubFlashRunnerId)||
   route.githubFlashRunnerName!==flashBuilder.githubRunnerName)
   return {ready:false,reason:"Provision a unique GitHub runner label on the device builder before generating the workflow",
    needsLabelProvisioning:true,workflow:null};
  deviceLabel=route.githubFlashRunnerLabel;
 }
 const workflow=projectWorkflow({route,release,buildLabel:route.githubRunnerLabel,deviceLabel,maincreateRef,defaultBranch});
 return {ready:true,reason:null,needsLabelProvisioning:false,workflow,
  filePath:".github/workflows/maincreate-device-pipeline.yml",runnerLabel:route.githubRunnerLabel,
  deviceRunnerLabel:deviceLabel,toolkitLabel:toolkitLabel(release),
  safety:"Builds produce checksum-verified artifacts. Device operations are separate manual workflow dispatches; firmware flashing and APK installation require explicit confirmation and a fresh hardware identity check."};
}
export async function provisionRunnerLabel({route,project,builder,organization,token,fetchImpl=fetch}){
 validState({route,project,builder,organization});
 return ensureRunnerLabel({builder,organization,token,fetchImpl});
}
