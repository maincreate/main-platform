import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {verifyFlashEvidence} from "./flash_evidence.mjs";

const hash=b=>createHash("sha256").update(b).digest("hex");
const mac="44:bd:8d:78:15:e8",port="/dev/ttyACM0";
const ids={
 flash:"1".repeat(32),backup:"2".repeat(32),security:"3".repeat(32),source:"4".repeat(32)
};
const now=Date.parse("2026-11-21T22:49:00Z");
function fixture(){
 const assets=[],payloads=new Map(),jobs=[];
 let seed=8;
 const add=(job,name,data)=>{
  const id=(++seed).toString(16).padStart(32,"0");
  assets.push({id,name,jobId:job.id,complete:true,size:data.length,sha256:hash(data)});
  job.assetIds.push(id);payloads.set(id,data);
 };
 const common={runnerId:"r1",status:"completed",completedAt:new Date(now-1000).toISOString()};
 const flashJob={id:ids.flash,runnerId:"r1",status:"awaiting_approval",capability:"firmware.esp_idf.flash",
  parameters:{port,expected_mac:mac,backup_job_id:ids.backup,security_job_id:ids.security,source_job_id:ids.source}};
 const backup={...common,id:ids.backup,capability:"firmware.esp_idf.backup",parameters:{port,expected_mac:mac},assetIds:[]};
 const security={...common,id:ids.security,capability:"firmware.esp_idf.security_preflight",parameters:{port,expected_mac:mac},assetIds:[]};
 const source={...common,id:ids.source,capability:"firmware.esp_idf.smoke_build",parameters:{version:"5.5.6"},assetIds:[]};
 jobs.push(backup,security,source);
 const securityRaw="Security Information:\nFlags: 0x00000000 (0b0)\nSecure Boot: Disabled\nFlash Encryption: Disabled\nSPI Boot Crypt Count (SPI_BOOT_CRYPT_CNT): 0x0\n";
 add(security,"esp32-security-info.json",Buffer.from(JSON.stringify({
  schema:1,port,chip:"ESP32-S3",mac,flash_size:"16MB",raw_security_info:securityRaw,
  security_verified:false,flash_allowed:false
 })));
 const parts=[],full=createHash("sha256");
 for(let i=0;i<4;i++){
  const bytes=Buffer.alloc(4*1024*1024,i+1);
  const name="esp32s3-backup-0"+i+".bin";
  add(backup,name,bytes);full.update(bytes);
  parts.push({name,offset:i*bytes.length,size:bytes.length,sha256:hash(bytes)});
 }
 add(backup,"esp32s3-backup-manifest.json",Buffer.from(JSON.stringify({
  schema:1,job_id:backup.id,port,chip:"ESP32-S3",mac,flash_size:"16MB",
  full_sha256:full.digest("hex"),parts,flash_allowed:false
 })));
 const files=[];
 for(const [name,n] of [["esp32s3-firmware.bin",2048],["esp32s3-bootloader.bin",2048],["esp32s3-partitions.bin",3072]]){
  const b=Buffer.alloc(n,42);add(source,name,b);files.push({name,size:n,sha256:hash(b)});
 }
 add(source,"esp32s3-firmware-manifest.json",Buffer.from(JSON.stringify({
  schema:1,job_id:source.id,framework:"esp-idf",framework_version:"5.5.6",target:"esp32s3",
  source_sha256:"a".repeat(64),files
 })));
 return {flashJob,jobs,assets,readAsset:a=>payloads.get(a.id),payloads,now};
}
test("real artifact bytes and full 16MiB digest authorize only matching approved target",()=>{
 const f=fixture(),ok=verifyFlashEvidence(f);
 assert.equal(ok.authorized,true);
 assert.equal(ok.mac,mac);assert.equal(ok.flash_size,"16MB");
 assert.equal(ok.backup_full_sha256.length,64);
 assert.equal(ok.security_sha256.length,64);
});
test("wrong target, stale security evidence and damaged recovery bytes fail closed",()=>{
 const f=fixture();
 f.flashJob.parameters.expected_mac="11:22:33:44:55:66";
 assert.throws(()=>verifyFlashEvidence(f),/another device/);
 f.flashJob.parameters.expected_mac=mac;
 f.jobs[1].completedAt=new Date(now-8*86400000).toISOString();
 assert.throws(()=>verifyFlashEvidence(f),/expired/);
 f.jobs[1].completedAt=new Date(now-1000).toISOString();
 const part=f.assets.find(a=>a.name==="esp32s3-backup-01.bin");
 f.payloads.get(part.id)[0]^=1;
 assert.throws(()=>verifyFlashEvidence(f),/checksum mismatch/);
});
test("enabled security flags or mismatched firmware manifest cannot authorize writes",()=>{
 const f=fixture();
 const a=f.assets.find(x=>x.name==="esp32-security-info.json");
 const securityDoc=JSON.parse(f.payloads.get(a.id).toString());
 securityDoc.raw_security_info=securityDoc.raw_security_info.replace("Secure Boot: Disabled","Secure Boot: Enabled");
 const bytes=Buffer.from(JSON.stringify(securityDoc));f.payloads.set(a.id,bytes);a.size=bytes.length;a.sha256=hash(bytes);
 assert.throws(()=>verifyFlashEvidence(f),/unknown\/unsafe/);
 securityDoc.raw_security_info=securityDoc.raw_security_info.replace("Secure Boot: Enabled","Secure Boot: Disabled");
 const recovered=Buffer.from(JSON.stringify(securityDoc));f.payloads.set(a.id,recovered);a.size=recovered.length;a.sha256=hash(recovered);
 const source=f.assets.find(x=>x.name==="esp32s3-firmware-manifest.json");
 const doc=JSON.parse(f.payloads.get(source.id).toString());
 doc.job_id="0".repeat(32);
 const modified=Buffer.from(JSON.stringify(doc));f.payloads.set(source.id,modified);source.size=modified.length;source.sha256=hash(modified);
 assert.throws(()=>verifyFlashEvidence(f),/manifest not supported/);
});

test("verified Arduino 3.2.0 Expressions import satisfies the same recovery and security gate",()=>{
 const f=fixture();
 const source=f.jobs.find(j=>j.id===ids.source);
 source.capability="firmware.esp_idf.import_build";
 const artifact=f.assets.find(a=>a.jobId===ids.source&&a.name==="esp32s3-firmware-manifest.json");
 const doc=JSON.parse(f.payloads.get(artifact.id).toString());
 doc.framework="arduino-esp32";doc.framework_version="3.2.0";
 const valid=Buffer.from(JSON.stringify(doc));
 f.payloads.set(artifact.id,valid);artifact.size=valid.length;artifact.sha256=hash(valid);
 assert.equal(verifyFlashEvidence(f).authorized,true);
 doc.framework_version="3.2.1";
 const invalid=Buffer.from(JSON.stringify(doc));
 f.payloads.set(artifact.id,invalid);artifact.size=invalid.length;artifact.sha256=hash(invalid);
 assert.throws(()=>verifyFlashEvidence(f),/manifest not supported/);
});
