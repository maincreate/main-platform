import {inflateRawSync} from "node:zlib";
import {createHash} from "node:crypto";

// Read a strictly bounded GitHub Actions artifact ZIP. Reject arbitrary files,
// directory traversal, symlinks, encrypted files, duplicates and ZIP bombs.
const MAX_ZIP=12*1024*1024;
const MAX_FILE=8*1024*1024;
const EXPECTED=new Set(["esp32s3-bootloader.bin","esp32s3-partitions.bin",
 "esp32s3-firmware.bin","expression-build.json"]);
const digest=b=>createHash("sha256").update(b).digest("hex");
const hex40=/^[0-9a-f]{40}$/;
const hex64=/^[0-9a-f]{64}$/;
const fail=reason=>{throw Object.assign(new Error("GitHub firmware import rejected: "+reason),{status:422});};

export function decodeFirmwareZip(data){
 const zip=Buffer.isBuffer(data)?data:Buffer.from(data);
 if(zip.length<22||zip.length>MAX_ZIP)fail("ZIP package outside permitted size");
 let eocd=-1;
 for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--){
  if(zip.readUInt32LE(i)===0x06054b50){eocd=i;break}
 }
 if(eocd<0)fail("ZIP directory missing");
 const count=zip.readUInt16LE(eocd+10),cdSize=zip.readUInt32LE(eocd+12),
       cdOffset=zip.readUInt32LE(eocd+16);
 if(count!==4||cdOffset+cdSize>eocd)fail("ZIP contains unexpected entries");
 let ptr=cdOffset,total=0;
 const files=new Map();
 for(let i=0;i<count;i++){
  if(ptr+46>zip.length||zip.readUInt32LE(ptr)!==0x02014b50)fail("invalid ZIP central entry");
  const flags=zip.readUInt16LE(ptr+8),method=zip.readUInt16LE(ptr+10),
        compressed=zip.readUInt32LE(ptr+20),uncompressed=zip.readUInt32LE(ptr+24),
        nameLen=zip.readUInt16LE(ptr+28),extraLen=zip.readUInt16LE(ptr+30),
        commentLen=zip.readUInt16LE(ptr+32),localOffset=zip.readUInt32LE(ptr+42),
        attrs=zip.readUInt32LE(ptr+38);
  if(ptr+46+nameLen+extraLen+commentLen>zip.length)fail("ZIP metadata truncated");
  const name=zip.subarray(ptr+46,ptr+46+nameLen).toString("utf8");
  if(!EXPECTED.has(name)||files.has(name)||flags&1||![0,8].includes(method)||
    uncompressed<1||uncompressed>MAX_FILE||compressed>MAX_ZIP||
    (attrs>>>16&0o170000)===0o120000)fail("ZIP contains an unsafe artifact");
  if(localOffset+30>zip.length||zip.readUInt32LE(localOffset)!==0x04034b50)
   fail("ZIP local header missing");
  const localNameLen=zip.readUInt16LE(localOffset+26),localExtraLen=zip.readUInt16LE(localOffset+28);
  const start=localOffset+30+localNameLen+localExtraLen;
  if(start+compressed>zip.length||
    zip.subarray(localOffset+30,localOffset+30+localNameLen).toString("utf8")!==name)
   fail("ZIP data truncated or filenames disagree");
  const packed=zip.subarray(start,start+compressed);
  let out;
  try{out=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:MAX_FILE})}
  catch{fail("ZIP decompression failed")}
  if(out.length!==uncompressed)fail("ZIP uncompressed length mismatch");
  total+=out.length;if(total>MAX_ZIP)fail("ZIP expands beyond permitted bounds");
  files.set(name,out);
  ptr+=46+nameLen+extraLen+commentLen;
 }
 if(files.size!==EXPECTED.size||ptr!==cdOffset+cdSize)fail("ZIP directory invalid");
 return files;
}

export function validateExpressionArtifacts(files,{repository,revision}){
 if(repository!=="BuilderBench/esp32-expression"||!hex40.test(revision||""))
  fail("repository or exact source revision not allowlisted");
 const manifestFile=files.get("expression-build.json");
 let manifest;
 try{manifest=JSON.parse(manifestFile.toString("utf8"))}
 catch{fail("build manifest is not valid JSON")}
 if(manifest.schema!==1||manifest.repository!==repository||manifest.revision!==revision||
  manifest.target!=="esp32s3"||
  manifest.board!=="Waveshare ESP32-S3-Touch-LCD-1.85B"||
  manifest.sdk!=="ESP-IDF 5.5.6"||
  manifest.waveshare_support_revision!=="5a98b8da1948340c07032a408ac0d93c47ca558f"||
  !Array.isArray(manifest.files)||manifest.files.length!==3)
   fail("board, SDK version or firmware revision mismatch");
 const seen=new Set();
 for(const item of manifest.files){
  if(!EXPECTED.has(item?.name)||item.name==="expression-build.json"||
    seen.has(item.name)||!hex64.test(item.sha256||""))fail("duplicate or unknown firmware artifact");
  seen.add(item.name);
  const bytes=files.get(item.name);
  if(!bytes||bytes.length!==item.size||bytes.length<1024||digest(bytes)!==item.sha256)
   fail("firmware binary does not match pinned build manifest");
 }
 if(seen.size!==3)fail("firmware image set incomplete");
 return {repository,revision,images:Object.fromEntries([...seen].map(name=>[name,files.get(name)])),
  sourceSha256:digest(manifestFile)};
}
