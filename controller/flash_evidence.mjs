import {createHash} from "node:crypto";

// One reviewable, fail-closed gate for the first ESP32-S3 firmware-write pilot.
// Called before approval AND again by the Host before an actual write.
const sha=buf=>createHash("sha256").update(buf).digest("hex");
const hex64=/^[a-f0-9]{64}$/;
const id32=/^[a-f0-9]{32}$/;
const expectedNames=["esp32s3-bootloader.bin","esp32s3-partitions.bin","esp32s3-firmware.bin"];
const backupNames=["esp32s3-backup-00.bin","esp32s3-backup-01.bin","esp32s3-backup-02.bin","esp32s3-backup-03.bin"];
const CHUNK=4*1024*1024,DEVICE_SIZE=16*1024*1024;
const reject=message=>{throw new Error("Flash preflight blocked: "+message);};
const selectJob=(jobs,id,capability)=>jobs.find(j=>j.id===id&&j.capability===capability&&j.status==="completed")||
 reject("required completed "+capability+" job not found");
function readVerifiedAsset(job,assets,name,readAsset){
 const matches=assets.filter(x=>x.jobId===job.id&&x.name===name&&x.complete&&
  job.assetIds?.includes(x.id));
 if(matches.length!==1)reject("unique complete "+name+" artifact required");
 const asset=matches[0];
 if(!id32.test(asset.id)||!hex64.test(asset.sha256||""))reject("invalid asset identity");
 const payload=readAsset(asset);
 if(!Buffer.isBuffer(payload)||payload.length!==asset.size||sha(payload)!==asset.sha256)
  reject("asset storage checksum mismatch for "+name);
 return payload;
}
function parseJSON(payload,name){
 try{return JSON.parse(payload.toString("utf8"))}catch{reject(name+" is not valid JSON")}
}
function checkSecurity(raw){
 // Require exact, independently observed esptool v4 security output; unknown,
 // unparseable or enabled protections must never authorize an unencrypted image.
 return /^Flags:\s*0x00000000\b/m.test(raw)&&
  /^Secure Boot:\s*Disabled\s*$/m.test(raw)&&
  /^Flash Encryption:\s*Disabled\s*$/m.test(raw)&&
  /^SPI Boot Crypt Count \(SPI_BOOT_CRYPT_CNT\):\s*0x0\s*$/m.test(raw);
}
export function verifyFlashEvidence({flashJob,jobs,assets,readAsset,now=Date.now()}){
 if(flashJob?.capability!=="firmware.esp_idf.flash"||
  !["awaiting_approval","queued","running"].includes(flashJob.status))
  reject("no active device-write job");
 const p=flashJob.parameters||{};
 const ids=[flashJob.id,p.backup_job_id,p.security_job_id,p.source_job_id];
 if(!ids.every(x=>typeof x==="string"&&id32.test(x))||
   new Set(ids).size!==4)reject("invalid or reused evidence job identity");
 if(!/^\/dev\/(ttyUSB[0-9]+|ttyACM[0-9]+)$/.test(p.port||"")||
  !/^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/.test(p.expected_mac||""))
  reject("exact device path and expected MAC required");
 const backup=selectJob(jobs,p.backup_job_id,"firmware.esp_idf.backup");
 const security=selectJob(jobs,p.security_job_id,"firmware.esp_idf.security_preflight");
 const source=selectJob(jobs,p.source_job_id,"firmware.esp_idf.smoke_build");
 for(const prior of [backup,security]){
  if(prior.runnerId!==flashJob.runnerId||
    prior.parameters?.port!==p.port||prior.parameters?.expected_mac!==p.expected_mac)
   reject("backup or security evidence belongs to another device/runner");
  const stamped=Date.parse(prior.completedAt||"");
  if(!Number.isFinite(stamped)||stamped>now||now-stamped>7*24*3600*1000)
   reject("backup/security evidence expired");
 }
 const securityPayload=readVerifiedAsset(security,assets,"esp32-security-info.json",readAsset);
 const securityDoc=parseJSON(securityPayload,"Security evidence");
 if(securityDoc.schema!==1||securityDoc.chip!=="ESP32-S3"||
   securityDoc.flash_size!=="16MB"||securityDoc.port!==p.port||
   securityDoc.mac!==p.expected_mac||
   typeof securityDoc.raw_security_info!=="string"||!checkSecurity(securityDoc.raw_security_info))
  reject("secure-boot or flash-encryption state unknown/unsafe");
 const manifestPayload=readVerifiedAsset(backup,assets,"esp32s3-backup-manifest.json",readAsset);
 const backupDoc=parseJSON(manifestPayload,"Backup manifest");
 if(backupDoc.schema!==1||backupDoc.job_id!==backup.id||backupDoc.chip!=="ESP32-S3"||
  backupDoc.mac!==p.expected_mac||backupDoc.port!==p.port||
  backupDoc.flash_size!=="16MB"||!hex64.test(backupDoc.full_sha256||"")||
  !Array.isArray(backupDoc.parts)||backupDoc.parts.length!==4)
  reject("full-chip recovery manifest is invalid");
 const full=createHash("sha256");
 for(let i=0;i<4;i++){
  const part=backupDoc.parts[i],name=backupNames[i];
  if(part?.name!==name||part.offset!==i*CHUNK||part.size!==CHUNK||
    !hex64.test(part.sha256||""))reject("full-chip backup part map is invalid");
  const bytes=readVerifiedAsset(backup,assets,name,readAsset);
  if(bytes.length!==CHUNK||sha(bytes)!==part.sha256)
   reject("full-chip backup part checksum mismatch");
  full.update(bytes);
 }
 if(full.digest("hex")!==backupDoc.full_sha256)
  reject("full-chip recovery image digest mismatch");
 const firmwareManifest=readVerifiedAsset(source,assets,"esp32s3-firmware-manifest.json",readAsset);
 const firmwareDoc=parseJSON(firmwareManifest,"Firmware manifest");
 if(firmwareDoc.schema!==1||firmwareDoc.job_id!==source.id||
  firmwareDoc.framework!=="esp-idf"||firmwareDoc.framework_version!=="5.5.6"||
  firmwareDoc.target!=="esp32s3"||!hex64.test(firmwareDoc.source_sha256||"")||
  !Array.isArray(firmwareDoc.files)||firmwareDoc.files.length!==3)
  reject("firmware source manifest not supported");
 const seen=new Set();
 for(const item of firmwareDoc.files){
  if(!expectedNames.includes(item?.name)||seen.has(item.name)||!hex64.test(item.sha256||""))
   reject("unknown or duplicate firmware image");
  seen.add(item.name);
  const bytes=readVerifiedAsset(source,assets,item.name,readAsset);
  if(item.size!==bytes.length||bytes.length<1024||bytes.length>8*1024*1024||
    sha(bytes)!==item.sha256)reject("firmware image verification failed");
 }
 return {authorized:true,port:p.port,mac:p.expected_mac,flash_size:"16MB",
  backup_full_sha256:backupDoc.full_sha256,
  security_sha256:sha(securityPayload),
  source_job_id:source.id,backup_job_id:backup.id,security_job_id:security.id};
}
