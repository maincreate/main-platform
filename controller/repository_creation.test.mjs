import {test} from "node:test";
import assert from "node:assert/strict";
import {validateRepositoryRequest,createOrganizationRepository,visibilityDefault} from "./repository_creation.mjs";

test("GitHub repository visibility defaults to private and explicit public override is preserved",()=>{
 assert.equal(visibilityDefault(undefined),"private");
 assert.equal(visibilityDefault("public"),"public");
 assert.deepEqual(validateRepositoryRequest({name:"firmware-device"},"MainCreate"),{
  organization:"MainCreate",name:"firmware-device",description:"",visibility:"private"
 });
 assert.equal(validateRepositoryRequest({name:" firmware ",visibility:"public",description:" Test "},"MainCreate").visibility,"public");
});

test("GitHub repo creation rejects invalid names, mismatched orgs and malformed visibility",()=>{
 for(const input of [{name:""}, {name:"bad/name"}, {name:".."}, {name:"firmware",visibility:"internal"},
  {name:"firmware",organization:"OtherOrg"}, {name:"firmware",description:"x".repeat(241)}]){
  assert.throws(()=>validateRepositoryRequest(input,"MainCreate"),e=>e.status===422);
 }
});

test("Create org repository uses fine-grained token only on server and enforces returned identity",async()=>{
 let calls=0;
 const mock=async(url,init)=>{
   calls++;
   assert.equal(url,"https://api.github.com/orgs/MainCreate/repos");
   assert.equal(init.method,"POST");
   assert.equal(init.headers.authorization,"Bearer "+"a".repeat(30));
   assert.deepEqual(JSON.parse(init.body),{name:"example-firmware",description:"Firmware test",private:true,auto_init:true});
   return {status:201,json:async()=>({id:12,name:"example-firmware",full_name:"MainCreate/example-firmware",
     private:true,owner:{login:"MainCreate"},html_url:"https://github.com/MainCreate/example-firmware"})};
 };
 const request=validateRepositoryRequest({name:"example-firmware",description:"Firmware test"},"MainCreate");
 const result=await createOrganizationRepository(request,"a".repeat(30),mock);
 assert.equal(result.visibility,"private");
 assert.equal(result.fullName,"MainCreate/example-firmware");
 assert.equal(calls,1);
});

test("Unauthorized creation, conflicts and wrong returned visibility fail safely",async()=>{
 const base=validateRepositoryRequest({name:"my-board"},"MainCreate");
 const mock=status=>async()=>({status,json:async()=>({})});
 await assert.rejects(createOrganizationRepository(base,"a".repeat(30),mock(403)),e=>e.status===403);
 await assert.rejects(createOrganizationRepository(base,"a".repeat(30),mock(422)),e=>e.status===409);
 await assert.rejects(createOrganizationRepository(base,"a".repeat(30),async()=>({status:201,json:async()=>({
    id:10,owner:{login:"MainCreate"},private:false,html_url:"https://github.com/MainCreate/my-board"})})),e=>e.status===502);
});
