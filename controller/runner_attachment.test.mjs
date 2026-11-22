import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const dir=mkdtempSync(join(tmpdir(),"maincreate-attachment-regression-"));
process.env.MAIN_DATA_DIR=dir;
const {observedFlashIdentity,findDeploymentEvidence}=await import("./fabric.mjs");
test.after(()=>rmSync(dir,{recursive:true,force:true}));

test("24-character enrolled runner IDs reach evidence validation rather than failing ID parsing",()=>{
 const runnerId="b227a30c16dedeaa4b4e45a5";
 assert.throws(()=>observedFlashIdentity({runnerId,port:"/dev/ttyACM0"}),/recent authenticated ESP32-S3 identity\/security preflight/);
 assert.throws(()=>findDeploymentEvidence({runnerId,port:"/dev/ttyACM0",mac:"44:bd:8d:78:15:e8",sourceJobId:"a".repeat(32)}),/Verified GitHub firmware build must be imported/);
});
test("invalid runner IDs and ports are still rejected",()=>{
 assert.throws(()=>observedFlashIdentity({runnerId:"runner-123",port:"/dev/ttyACM0"}),/Exact enrolled device attachment required/);
 assert.throws(()=>observedFlashIdentity({runnerId:"b227a30c16dedeaa4b4e45a5",port:"/dev/ttyACM0;bad"}),/Exact enrolled device attachment required/);
});
