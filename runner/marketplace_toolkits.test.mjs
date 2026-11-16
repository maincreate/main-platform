import {test} from "node:test";
import assert from "node:assert/strict";
import {ESP_IDF_RELEASES,ANDROID_RELEASE,espIdfRoot,androidRoot,installEspIdf,installAndroidSdk,cleanupToolkit,validateFirmwareManifest,validateFlasherArgs} from "./marketplace_toolkits.mjs";

test("ESP-IDF exposes only pinned stable versions and Linux builder architectures",()=>{
 assert.deepEqual(Object.keys(ESP_IDF_RELEASES).sort(),["5.5.6","6.1.1"]);
 for(const version of Object.keys(ESP_IDF_RELEASES)){
  for(const arch of ["arm64","x64"]){
   const recipe=ESP_IDF_RELEASES[version].targets["linux/"+arch];
   assert.match(recipe.sha256,/^[a-f0-9]{64}$/);
   assert.match(recipe.url,/github\.com\/espressif\/idf-im-ui\/releases/);
  }
 }
});
test("Android build SDK is Linux x64 only and pinned to Google's checksum",()=>{
 assert.equal(ANDROID_RELEASE.hosts["linux/x64"].sha256,"4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583");
 assert.equal(ANDROID_RELEASE.hosts["linux/arm64"],undefined);
 assert.deepEqual(ANDROID_RELEASE.packages,["platform-tools","build-tools;36.0.0","platforms;android-37","platforms;android-22"]);
});
test("toolkit installations are version-isolated",()=>{
 assert.match(espIdfRoot("6.1.1","/tmp/sdk"),/esp-idf\/6\.1\.1$/);
 assert.match(androidRoot("/tmp/sdk"),/android\/2026\.2\.2-patch1$/);
});
test("unsupported hosts and missing Android license consent fail before downloads",async()=>{
 let downloaded=false;
 const downloadFn=async()=>{downloaded=true;return Buffer.from("not a release");};
 await assert.rejects(()=>installEspIdf({version:"6.1.1",os:"windows",architecture:"x64",downloadFn}),/not supported/);
 await assert.rejects(()=>installAndroidSdk({os:"linux",architecture:"arm64",acceptLicenses:true,downloadFn}),/not supported/);
 await assert.rejects(()=>installAndroidSdk({os:"linux",architecture:"x64",acceptLicenses:false,downloadFn}),/license acceptance/);
 assert.equal(downloaded,false);
});
test("cleanup is dry-run by default and refuses active job references",async()=>{
 const result=await cleanupToolkit({family:"esp-idf",version:"6.1.1",root:"/tmp/maincreate-sdk-test"});
 assert.equal(result.dryRun,true);assert.equal(result.deleted,false);
 await assert.rejects(()=>cleanupToolkit({family:"esp-idf",version:"6.1.1",root:"/tmp/maincreate-sdk-test",activeJobs:["job-1"]}),/active jobs/);
});

test("ESP-IDF firmware manifests pin target, toolkit, revision and digest",()=>{
 const valid={kind:"maincreate-esp-idf-firmware-bundle",toolkitVersion:"6.1.1",targetChip:"esp32s3",sourceRevision:"a".repeat(40),bundleSha256:"b".repeat(64)};
 assert.equal(validateFirmwareManifest(valid,{version:"6.1.1",chip:"ESP32S3"}),valid);
 assert.throws(()=>validateFirmwareManifest(valid,{version:"5.5.6",chip:"ESP32S3"}),/does not match/);
 assert.throws(()=>validateFirmwareManifest({...valid,targetChip:"esp32"}, {version:"6.1.1",chip:"esp32s3"}),/does not match/);
});
test("ESP-IDF flash map accepts bounded offsets and safe files only",()=>{
 const map={flash_files:{"0x1000":"bootloader.bin","0x8000":"partition-table.bin"},write_flash_args:["--flash-mode","dio","--flash-size","4MB"]};
 const parsed=validateFlasherArgs(map,"/tmp/build");
 assert.equal(parsed.files.length,2);
 assert.throws(()=>validateFlasherArgs({...map,flash_files:{"0x0":"../escape.bin"}},"/tmp/build"),/Unsafe/);
 assert.throws(()=>validateFlasherArgs({...map,write_flash_args:["--port","/dev/ttyUSB0"]},"/tmp/build"),/Unsupported/);
});

test("Android SDK refuses hosts without a supported JDK before downloading",async()=>{
 let downloaded=false;
 const downloadFn=async()=>{downloaded=true;return Buffer.from("not a release");};
 const runner=async()=> 'openjdk version "11.0.28"';
 await assert.rejects(()=>installAndroidSdk({os:"linux",architecture:"x64",acceptLicenses:true,downloadFn,runner}),/JDK 17 or newer/);
 assert.equal(downloaded,false);
});

test("approved cleanup removes only the selected version-owned toolkit directory",async()=>{
 const root="/tmp/maincreate-sdk-cleanup-test-"+process.pid;
 const {mkdirSync,existsSync,rmSync}=await import("node:fs");
 mkdirSync(espIdfRoot("6.1.1",root),{recursive:true});
 mkdirSync(espIdfRoot("5.5.6",root),{recursive:true});
 const result=await cleanupToolkit({family:"esp-idf",version:"6.1.1",root,dryRun:false});
 assert.equal(result.deleted,true);
 assert.equal(existsSync(espIdfRoot("6.1.1",root)),false);
 assert.equal(existsSync(espIdfRoot("5.5.6",root)),true);
 rmSync(root,{recursive:true,force:true});
});
