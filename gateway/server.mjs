import {createServer} from "node:http";
import {createHash,timingSafeEqual} from "node:crypto";

const host=process.env.HOST||"0.0.0.0",port=Number(process.env.PORT||"3001");
const controller=process.env.TT_CONTROLLER_URL||"http://portal:3000";
const serviceToken=process.env.TT_SERVICE_TOKEN||"",bearer=process.env.TT_MCP_TOKEN||"";
const allowedOrigins=(process.env.TT_MCP_ALLOWED_ORIGINS||"").split(",").map(s=>s.trim()).filter(Boolean);
const version="2025-11-25";
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Bad PORT");
function equal(a,b){const x=createHash("sha256").update(a).digest(),y=createHash("sha256").update(b).digest();return timingSafeEqual(x,y);}
function send(res,status,body,headers={}){res.writeHead(status,{"cache-control":"no-store","x-content-type-options":"nosniff","content-type":"application/json; charset=utf-8",...headers});res.end(body===null?"":JSON.stringify(body));}
const error=(id,code,message)=>({jsonrpc:"2.0",id,error:{code,message}});
const ok=(id,result)=>({jsonrpc:"2.0",id,result});
const object=(properties={},required=[])=>({type:"object",properties,required,additionalProperties:false});
const textField={type:"string"},idField={type:"string",description:"Server-issued identifier"};
const tools=[
 {name:"tt_discover",title:"Discover TinkerTunnel resources",description:"Find installed runners, workspace details and versioned capability manifests. Read only.",
  annotations:{readOnlyHint:true},inputSchema:object({resource:{type:"string",enum:["all","capabilities","runners","workspace","jobs","assets"]},query:textField})},
 {name:"tt_inspect",title:"Inspect one resource",description:"Read the input schema and supported platforms of a capability, an enrolled runner or an existing job. Read only.",
  annotations:{readOnlyHint:true},inputSchema:object({resource:{type:"string",enum:["capability","runner","job"]},id:idField},["id"])},
 {name:"tt_plan",title:"Plan a validated capability",description:"Validate parameters for a pinned capability or composed workflow against a specific runner. Produces an immutable expiring plan; no execution.",
  annotations:{readOnlyHint:false,destructiveHint:false},inputSchema:object({capability:textField,runner_id:idField,parameters:{type:"object",description:"Capability-specific parameters from tt_inspect; no arbitrary shell command."}},["capability","runner_id"])},
 {name:"tt_execute",title:"Request approved execution",description:"Submit a previously validated plan as an approval-pending job. Never executes without signed-in portal approval and operator-enabled runner.",
  annotations:{readOnlyHint:false,destructiveHint:false},inputSchema:object({plan_id:idField},["plan_id"])},
 {name:"tt_jobs",title:"Track or cancel jobs",description:"List, inspect, retrieve bounded logs or cancel an unclaimed job. Cannot cancel an already running process.",
  annotations:{readOnlyHint:false,destructiveHint:false},inputSchema:object({action:{type:"string",enum:["list","get","logs","cancel"]},job_id:idField})},
 {name:"tt_assets",title:"Transfer bounded assets",description:"List, upload in ordered base64 chunks, finish with optional sha256 verification or read artifacts in chunks. Files are isolated in TinkerTunnel storage; no filesystem paths.",
  annotations:{readOnlyHint:false,destructiveHint:false},inputSchema:object({action:{type:"string",enum:["list","begin","chunk","finish","get"]},job_id:idField,
   asset_id:idField,name:textField,size:{type:"integer"},mime:textField,offset:{type:"integer"},
   length:{type:"integer"},content_base64:textField,sha256:textField})}
];
async function get(path,opts={}){
 const u=new URL(path,controller);
 if(u.origin!==new URL(controller).origin)throw new Error("Invalid controller URL");
 const r=await fetch(u,{...opts,signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>({error:"Invalid controller response"}));
 if(!r.ok)throw new Error(data.error||"Controller returned HTTP "+r.status);
 return data;
}
async function legacy(name,args){
 const headers={authorization:"Bearer "+serviceToken};
 if(name==="tinkertunnel_status")return get("/api/internal/status",{headers});
 if(name==="tinkertunnel_list_runners"){
  const s=await get("/api/internal/status",{headers});
  return {runners:s.runners||[],jobExecution:s.executionEnabled?"operator-enabled":"disabled"};
 }
 if(name==="tinkertunnel_framework_catalog")return get("/api/v1/catalog");
 if(name==="tinkertunnel_plan_install"){
  if(!["framework","os","arch"].every(k=>typeof args?.[k]==="string"))throw new Error("framework, os, arch required");
  return get("/api/v1/plans",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({framework:args.framework,os:args.os,arch:args.arch})});
 }
 throw new Error("Unknown tool");
}
async function call(name,args){
 if(tools.some(t=>t.name===name)){
  return get("/api/internal/fabric",{method:"POST",
   headers:{"content-type":"application/json",authorization:"Bearer "+serviceToken},
   body:JSON.stringify({tool:name,arguments:args})});
 }
 // Compatibility for users who saved the original 4 tool names; not advertised.
 return legacy(name,args);
}
const legacyNames=["tinkertunnel_status","tinkertunnel_list_runners",
 "tinkertunnel_framework_catalog","tinkertunnel_plan_install"];
async function processMessage(message){
 if(!message||message.jsonrpc!=="2.0"||typeof message.method!=="string")
  return error(message?.id??null,-32600,"Invalid JSON-RPC request");
 if(!("id" in message))return null;
 const id=message.id;
 switch(message.method){
  case "initialize":return ok(id,{protocolVersion:version,
   capabilities:{tools:{listChanged:false}},serverInfo:{name:"tinkertunnel",version:"0.2.0"}});
  case "ping":return ok(id,{});
  case "tools/list":return ok(id,{tools});
  case "tools/call":{
   const name=message.params?.name;
   if(!tools.some(t=>t.name===name)&&!legacyNames.includes(name))
    return error(id,-32602,"Unknown tool");
   try{
    const result=await call(name,message.params?.arguments||{});
    return ok(id,{content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result,isError:false});
   }catch(e){
    return ok(id,{content:[{type:"text",text:"Request rejected: "+e.message}],isError:true});
   }
  }
  default:return error(id,-32601,"Method not found");
 }
}
createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url||"/","http://localhost").pathname;
  if(pathname==="/healthz"&&req.method==="GET")return send(res,200,{ok:true,authConfigured:bearer.length>=32,tools:tools.length});
  if(pathname!=="/mcp")return send(res,404,{error:"Not found"});
  if(!["POST","GET"].includes(req.method))return send(res,405,{error:"Method not allowed"},{allow:"POST, GET"});
  if(req.method==="GET")return send(res,405,{error:"SSE GET unsupported"},{allow:"POST"});
  const origin=req.headers.origin;
  if(origin&&!allowedOrigins.includes(origin))return send(res,403,{error:"Origin rejected"});
  if(bearer.length<32||serviceToken.length<32)return send(res,503,{error:"MCP gateway not configured"});
  if(!equal(req.headers.authorization||"","Bearer "+bearer))
   return send(res,401,{error:"Unauthorized"},{"www-authenticate":'Bearer realm="tinkertunnel-mcp"'});
  const accept=req.headers.accept||"";
  if(!accept.includes("application/json")||!accept.includes("text/event-stream"))
   return send(res,406,{error:"Accept must include application/json and text/event-stream"});
  if(!(req.headers["content-type"]||"").startsWith("application/json"))
   return send(res,415,{error:"JSON body required"});
  let raw="",length=0;
  for await(const chunk of req){
   length+=chunk.length;if(length>85000)return send(res,413,{error:"Request too large"});
   raw+=chunk;
  }
  let message;try{message=JSON.parse(raw);}catch{return send(res,400,error(null,-32700,"Invalid JSON"));}
  if(Array.isArray(message))return send(res,400,error(null,-32600,"Batch requests unsupported"));
  const result=await processMessage(message);
  if(result===null){res.writeHead(202,{"cache-control":"no-store"});return res.end();}
  return send(res,200,result);
 }catch(e){console.error("MCP error:",e.message);return send(res,500,{error:"Internal error"});}
}).listen(port,host,()=>console.log("TinkerTunnel MCP listening on "+host+":"+port));
