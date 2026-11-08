import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {join,dirname,normalize} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const dockerfile=readFileSync(join(root,"Dockerfile"),"utf8");
const packages=new Set();
for(const line of dockerfile.split("\n")){
 if(!/^COPY\s+/.test(line))continue;
 const tokens=line.trim().split(/\s+/);
 const sources=tokens.slice(1,-1).filter(x=>!x.startsWith("--"));
 for(const file of sources)if(!file.includes("*"))packages.add(file.replace(/^\.\//,""));
}
function imports(file){
 const source=readFileSync(join(root,file),"utf8");
 const refs=[...source.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g),
             ...source.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g)];
 return refs.map(m=>normalize(join(dirname(file),m[1])).replaceAll("\\","/"));
}

test("Docker image includes every transitive local module imported by server and agent",()=>{
 const seen=new Set(),queue=["portal/server.mjs","runner/agent.mjs"];
 while(queue.length){
  const file=queue.pop();
  if(seen.has(file))continue;
  seen.add(file);
  assert(existsSync(join(root,file)),file+" is missing from source");
  assert(packages.has(file),"Dockerfile is not packaging runtime dependency "+file);
  for(const next of imports(file)){
   if(next.endsWith(".mjs")||next.endsWith(".js"))queue.push(next);
  }
 }
 assert(seen.has("controller/build_flash_routing.mjs"),
   "Build/flash routing must be in the portal runtime dependency closure");
});

test("Docker build resolves portal modules before startup",()=>{
 assert.match(dockerfile,/RUN node -e "import\('\.\/controller\/routes\.mjs'\)/);
});
