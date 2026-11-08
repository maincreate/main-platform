import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash,createPublicKey,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {publicHostPairRoute,adminHostPairRoute,verifyEnrolledPair} from "./pairing.mjs";

function makeContext(){
 const s={admin:{username:"admin"},invites:[],pendingHostPairs:[]};
 const ctx={
  state:()=>s,save:()=>{},body:async req=>req.json(),
  reply:(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}}),
  deny:(status,message)=>new Response(JSON.stringify({error:message}),{status,headers:{"content-type":"application/json"}}),
  limited:()=>false,session:()=>({username:"admin"}),
  rnd:()=>randomBytes(32).toString("hex"),
  digest:v=>createHash("sha256").update(v).digest("hex"),
  seal:v=>({value:v}),unseal:v=>v.value
 };
 return {s,ctx};
}
const request=(route,body,method="POST")=>new Request("https://controller.example"+route,{
 method,headers:method==="POST"?{"content-type":"application/json"}:{},
 ...(method==="POST"?{body:JSON.stringify(body)}:{})
});
async function json(response){return response.json();}
function signed(key,phase,values){
 return sign(null,Buffer.from("tinkertunnel-host-"+phase+"-v1\n"+values.join("\n")),
  key).toString("base64");
}
test("manual URL pairing requires matching confirmed fingerprint, key possession, and one-time invitation",async()=>{
 const {s,ctx}=makeContext();
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");
 const spki=publicKey.export({format:"der",type:"spki"});
 const announce=await publicHostPairRoute(request("/api/host/pair/announce",{
  name:"pi-builder",os:"linux",arch:"arm64",publicKey:spki.toString("base64")
 }),ctx);
 assert.equal(announce.status,200);
 const a=await json(announce);
 assert.match(a.id,/^[a-f0-9]{32}$/);
 const host=s.pendingHostPairs[0];
 const expected="SHA256:"+createHash("sha256").update(spki).digest("base64").replace(/=+$/,"");
 assert.equal(host.fingerprint,expected);
 const pending=await adminHostPairRoute(new Request("https://controller.example/api/local/builders/pending"),ctx);
 assert.equal((await json(pending)).hosts[0].fingerprint,expected);
 const rejected=await adminHostPairRoute(request("/api/local/builders/approve",{
  id:a.id,fingerprint:"SHA256:"+"A".repeat(43),confirmed:true}),ctx);
 assert.equal(rejected.status,409);
 const noConfirm=await adminHostPairRoute(request("/api/local/builders/approve",{
  id:a.id,fingerprint:expected,confirmed:false}),ctx);
 assert.equal(noConfirm.status,422);
 const deniedProof=await publicHostPairRoute(request("/api/host/pair/poll",{
  id:a.id,signature:"invalid-signature"}),ctx);
 assert.equal(deniedProof.status,401);
 const approve=await adminHostPairRoute(request("/api/local/builders/approve",{
  id:a.id,fingerprint:expected,confirmed:true}),ctx);
 assert.equal(approve.status,200);
 const poll=await publicHostPairRoute(request("/api/host/pair/poll",{
  id:a.id,signature:signed(privateKey,"poll",[a.id,a.nonce])}),ctx);
 assert.equal(poll.status,200);
 const result=await json(poll);
 assert.equal(result.state,"approved");
 assert.equal(result.enrollmentToken.length,64);
 const invitation=s.invites[0];
 assert.equal(invitation.hostFingerprint,expected);
 const enroll={name:"pi-builder",os:"linux",arch:"arm64",publicKey:spki.toString("base64"),
  token:result.enrollmentToken};
 enroll.signature=signed(privateKey,"enroll",[enroll.token,enroll.name,enroll.os,enroll.arch]);
 assert(verifyEnrolledPair(invitation,enroll));
 assert(!verifyEnrolledPair(invitation,{...enroll,arch:"x64"}));
 const another=generateKeyPairSync("ed25519");
 assert(!verifyEnrolledPair(invitation,{...enroll,
  publicKey:another.publicKey.export({format:"der",type:"spki"}).toString("base64")}));
 const replay=await publicHostPairRoute(request("/api/host/pair/poll",{
  id:a.id,signature:signed(privateKey,"poll",[a.id,a.nonce])}),ctx);
 assert.equal(replay.status,404);
});
test("pairing rejects malformed announcements and does not accept SSH-based onboarding",async()=>{
 const {ctx}=makeContext();
 const bad=await publicHostPairRoute(request("/api/host/pair/announce",{
  name:"pi",os:"linux",arch:"arm",publicKey:"not-a-key"
 }),ctx);
 assert.equal(bad.status,422);
 const noPair=await publicHostPairRoute(request("/api/host/pair/announce",{
  name:"pi",os:"linux",arch:"arm64",publicKey:"not-a-key"
 }),ctx);
 assert.equal(noPair.status,422);
 assert.equal(await publicHostPairRoute(request("/api/host/ssh",{}),ctx),null);
});
