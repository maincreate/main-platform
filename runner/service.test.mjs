import {test} from "node:test";
import assert from "node:assert/strict";
import {controllerAddress,pairingLink} from "./service.mjs";

test("Host Service accepts trusted HTTPS controller origins only",()=>{
 assert.equal(controllerAddress("https://tt.example.local"),"https://tt.example.local");
 for(const u of ["http://tt.example.local","https://user:pass@tt.example.local",
  "https://tt.example.local/path","https://tt.example.local?x=1","ftp://tt.example.local"])
  assert.throws(()=>controllerAddress(u),{code:"PAIRING_FAILED"});
});
test("pairing links point at the authenticated controller flow",()=>{
 const id="a".repeat(32);
 assert.equal(pairingLink("https://tt.example.local",id),
  "https://tt.example.local/builders?add=1&pair="+id);
 assert.throws(()=>pairingLink("https://tt.example.local","bad"),{code:"PAIRING_FAILED"});
});
