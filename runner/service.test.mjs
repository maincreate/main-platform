import {test} from "node:test";
import assert from "node:assert/strict";
import {controllerAddress,identityName,requestInvitation} from "./service.mjs";

test("Host Service accepts HTTPS controller origins only",()=>{
 assert.equal(controllerAddress("https://tt.example.local"),"https://tt.example.local");
 for(const u of ["http://tt.example.local","https://user:pass@tt.example.local",
  "https://tt.example.local/path","https://tt.example.local?x=1","ftp://tt.example.local"])
  assert.throws(()=>controllerAddress(u),{code:"PAIRING_FAILED"});
});
test("Host Service does not accept unbounded or malformed account names",()=>{
 assert.equal(identityName("builder_admin"),"builder_admin");
 for(const n of ["root user","", "a".repeat(65)])assert.throws(()=>identityName(n));
});
test("pairing uses a short-lived controller session and logs out",async()=>{
 const calls=[];
 const transport=async(url,method,body,cookie,csrf)=>{
  calls.push({url,method,body,cookie,csrf});
  if(url.endsWith("/login"))return {response:{headers:{get:()=> "ttsid="+"a".repeat(64)+"; HttpOnly"}},result:{csrf:"c".repeat(64)}};
  if(url.endsWith("/invite"))return {response:{headers:{get:()=>null}},result:{token:"b".repeat(64)}};
  return {response:{headers:{get:()=>null}},result:{ok:true}};
 };
 const token=await requestInvitation("https://tt.example.local","operator","ephemeral-password",transport);
 assert.equal(token,"b".repeat(64));
 assert.deepEqual(calls.map(c=>c.url.split("/").at(-1)),["login","invite","logout"]);
 assert.equal(calls[1].cookie,"ttsid="+"a".repeat(64));
 assert.equal(calls[1].csrf,"c".repeat(64));
 assert.equal(calls[2].body.password,undefined);
});
