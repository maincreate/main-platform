import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateFlows,documents,contract} from "../scripts/ux-docs.mjs";

test("UX flows have unique named stages, actions, failure paths and limitations",()=>{
 assert.equal(validateFlows(contract),true);
 assert.ok(contract.flows.some(f=>f.id==="builder-add"));
 assert.ok(contract.flows.some(f=>f.id==="builder-remove"));
 assert.ok(contract.flows.some(f=>f.id==="device-discover"));
 for(const flow of contract.flows){
  for(const stage of flow.steps)assert.ok(stage.recovery&&stage.failure&&stage.success);
 }
});
test("Support pages match the machine-readable UX contract",()=>{
 for(const [path,rendered] of documents()){
  const stored=readFileSync(new URL("../"+path,import.meta.url),"utf8");
  assert.equal(stored,rendered,path+" is stale; npm run docs:generate");
 }
});
test("Unsupported device operations are explicitly planned, not implemented",()=>{
 for(const name of ["device-identify","firmware-flash"])
  assert.equal(contract.flows.find(f=>f.id===name).status,"planned");
});
