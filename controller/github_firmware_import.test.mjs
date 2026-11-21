import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {decodeFirmwareZip,validateExpressionArtifacts} from "./github_firmware_import.mjs";

const sha=b=>createHash("sha256").update(b).digest("hex");
const REV="a".repeat(40);
function packageFiles(){
 const names=["esp32s3-bootloader.bin","esp32s3-partitions.bin","esp32s3-firmware.bin"];
 const files=new Map(names.map((name,i)=>[name,Buffer.alloc(2048+i*1024,i+1)]));
 const manifest={schema:1,repository:"BuilderBench/esp32-expression",revision:REV,
  target:"esp32s3",board:"Waveshare ESP32-S3-Touch-LCD-1.85B",
  framework:"arduino-esp32",framework_version:"3.2.0",lvgl:"9.3.0",
  waveshare_support_revision:"5a98b8da1948340c07032a408ac0d93c47ca558f",
  files:names.map(name=>({name,size:files.get(name).length,sha256:sha(files.get(name))}))};
 files.set("expression-build.json",Buffer.from(JSON.stringify(manifest)));
 return files;
}
// Generate four STORED members without external ZIP dependencies.
function zip(files){
 const local=[],central=[];
 let offset=0;
 for(const [name,data] of files){
  const label=Buffer.from(name),lh=Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50,0);
  lh.writeUInt16LE(20,4);lh.writeUInt16LE(0,6);lh.writeUInt16LE(0,8);
  lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(data.length,22);
  lh.writeUInt16LE(label.length,26);
  local.push(lh,label,data);
  const c=Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50,0);
  c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
  c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);
  c.writeUInt16LE(label.length,28);c.writeUInt32LE(offset,42);
  central.push(c,label);
  offset+=lh.length+label.length+data.length;
 }
 const cd=Buffer.concat(central);
 const end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.size,8);
 end.writeUInt16LE(files.size,10);end.writeUInt32LE(cd.length,12);
 end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,cd,end]);
}
test("accept exact 1.85B Arduino firmware package and verify every byte",()=>{
 const files=packageFiles(),loaded=decodeFirmwareZip(zip(files));
 const verified=validateExpressionArtifacts(loaded,{
  repository:"BuilderBench/esp32-expression",revision:REV});
 assert.equal(verified.revision,REV);
 assert.equal(Object.keys(verified.images).length,3);
 assert.equal(verified.sourceSha256,sha(files.get("expression-build.json")));
});
test("block source revision, board, SDK, image and ZIP entry mismatches",()=>{
 const files=packageFiles(),read=()=>decodeFirmwareZip(zip(files));
 assert.throws(()=>validateExpressionArtifacts(read(),{
  repository:"BuilderBench/esp32-expression",revision:"b".repeat(40)}),/mismatch/);
 files.get("esp32s3-firmware.bin")[0]^=1;
 assert.throws(()=>validateExpressionArtifacts(read(),{
  repository:"BuilderBench/esp32-expression",revision:REV}),/does not match/);
 const other=packageFiles();other.set("../secret.txt",Buffer.from("secret"));other.delete("esp32s3-firmware.bin");
 assert.throws(()=>decodeFirmwareZip(zip(other)),/unsafe artifact/);
});
