const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {Script}=require("node:vm");
const {join}=require("node:path");
test("Marketplace, Projects and Builders browser scripts parse",()=>{
 for(const name of ["marketplace.js","projects.js","builders.js"]){
  const source=readFileSync(join(__dirname,name),"utf8");
  assert.doesNotThrow(()=>new Script(source,{filename:name}),name+" is valid browser JavaScript");
 }
});
test("new Marketplace UI has a matching real element for every bound control",()=>{
 const source=readFileSync(join(__dirname,"marketplace.js"),"utf8");
 const html=readFileSync(join(__dirname,"marketplace.html"),"utf8");
 const matches=[...source.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
 for(const id of new Set(matches))
  assert.ok(html.includes('id="'+id+'"'),"Missing Marketplace element: "+id);
 assert.ok(source.includes("/api/local/marketplace/install"));
 assert.ok(!html.includes("Save installation plan"));
 assert.ok(!html.includes('id="mcuCatalog"'),"MCU database is contextual, not Marketplace landing content");
});
