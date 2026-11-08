import {test} from "node:test";
import assert from "node:assert/strict";
import {compatibilityForDevice,microcontrollerCatalog} from "./microcontrollers.mjs";

test("Microcontroller marketplace has source-backed, non-executable profiles",()=>{
 const catalog=microcontrollerCatalog();
 assert.equal(catalog.policy.flashRequiresActiveChipProbe,true);
 assert.equal(catalog.policy.installationRequiresValidatedRecipe,true);
 assert.ok(catalog.families.length>=6);
 for(const family of catalog.families){
  assert.ok(family.sources.length);
  assert.ok(family.sdk.every(s=>["pilot","review","board-dependent-review"].includes(s.status)));
 }
});
test("ESP USB Serial/JTAG is an uncertain family hint, not ESP32-S3 proof",()=>{
 const result=compatibilityForDevice({id:"a",vid:0x303a,pid:0x1001});
 assert.equal(result.verifiedChip,null);
 assert.equal(result.flashReady,false);
 assert.equal(result.candidates[0].familyId,"espressif-esp32");
 assert.ok(result.candidates[0].candidateChips.includes("ESP32-S3"));
 assert.ok(result.candidates[0].candidateChips.length>1);
});
test("Unknown USB-UART adapter cannot infer chip or firmware compatibility",()=>{
 const result=compatibilityForDevice({vid:0x10c4,pid:0xea60});
 assert.equal(result.unknown,true);
 assert.equal(result.candidates.length,0);
 assert.equal(result.flashReady,false);
});
