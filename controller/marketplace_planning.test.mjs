import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releases,classifyBuilder,makeInstallationPlan,validateAssignment} from './marketplace_planning.mjs';
const pi={id:'a',name:'pi-desk',os:'linux',arch:'arm64',managedHost:{host:'pi.local'},
 assignment:{location:'Orlando / desk',assignedTo:'Engineer A'}};
const unmanaged={id:'b',name:'unmanaged',os:'linux',arch:'arm64'};
const mac={id:'c',name:'mac',os:'macos',arch:'arm64',managedHost:{host:'mac.local'}};
const hosts=[pi,unmanaged,mac];
test('Versioned registry returns releases and recognized host compatibility',()=>{
 const esp=releases().find(x=>x.id==='esp-idf@5.5.6');
 assert(esp);assert.equal(classifyBuilder(pi,esp).compatible,true);
 assert.equal(classifyBuilder(unmanaged,esp).compatible,false);
});
test('Selected builders is explicit, durable and does not install',()=>{
 const plan=makeInstallationPlan({family:'esp-idf',version:'5.5.6',placement:'selected',builder_ids:['a']},hosts,'tester');
 assert.equal(plan.targets.length,1);assert.equal(plan.targets[0].location,'Orlando / desk');
 assert.equal(plan.execution,'not_started');assert.equal(plan.status,'planned');
 assert.equal(plan.targets[0].status,'awaiting_validated_installer');
});
test('All-compatible includes only managed and matching platform variants',()=>{
 const plan=makeInstallationPlan({family:'swift',version:'6.1.2',placement:'all-compatible'},hosts,'tester');
 assert.deepEqual(plan.targets.map(x=>x.builderId),['c']);
});
test('Explicit all-compatible does not accept selected IDs',()=>{
 assert.throws(()=>makeInstallationPlan({family:'esp-idf',version:'5.5.6',placement:'all-compatible',builder_ids:['a']},hosts,'tester'));
});
test('Selected targets reject unmanaged hosts, duplicates and invalid release',()=>{
 for(const input of [
  {family:'esp-idf',version:'5.5.6',placement:'selected',builder_ids:['b']},
  {family:'esp-idf',version:'5.5.6',placement:'selected',builder_ids:['a','a']},
  {family:'esp-idf',version:'999.0',placement:'selected',builder_ids:['a']}
 ])assert.throws(()=>makeInstallationPlan(input,hosts,'tester'));
});
test('Builder metadata is bounded and separated from identity',()=>{
 assert.deepEqual(validateAssignment({displayName:'Pi desk',location:'Orlando / Desk 1',assignedTo:'Engineer A',accessGroup:'firmware'}),{
  displayName:'Pi desk',location:'Orlando / Desk 1',assignedTo:'Engineer A',accessGroup:'firmware'
 });
 assert.throws(()=>validateAssignment({displayName:'\n',location:'',assignedTo:'',accessGroup:''}));
});
