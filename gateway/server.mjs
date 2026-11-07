import {createServer} from "node:http";
import {createHash, timingSafeEqual} from "node:crypto";

const host=process.env.HOST||"0.0.0.0",port=Number(process.env.PORT||"3001");
const controller=process.env.TT_CONTROLLER_URL||"http://portal:3000";
const serviceToken=process.env.TT_SERVICE_TOKEN||"";
const bearer=process.env.TT_MCP_TOKEN||"";
const allowedOrigins=(process.env.TT_MCP_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
const version="2025-11-25";
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Bad PORT");
function equal(a,b){const x=createHash("sha256").update(a).digest(),y=createHash("sha256").update(b).digest();return timingSafeEqual(x,y);}
function send(res,status,body,headers={}){res.writeHead(status,{"cache-control":"no-store","x-content-type-options":"nosniff","content-type":"application/json; charset=utf-8",...headers});res.end(body===null?"":JSON.stringify(body));}
function error(id,code,message){return {jsonrpc:"2.0",id,error:{code,message}};}
function ok(id,result){return {jsonrpc:"2.0",id,result};}
const tools=[
 {name:"tinkertunnel_status",description:"Read the local controller's configuration and health; does not run jobs.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"tinkertunnel_list_runners",description:"List enrolled execution agents and heartbeat state; read only.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"tinkertunnel_framework_catalog",description:"List available framework recipes and supported OS targets; read only.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"tinkertunnel_plan_install",description:"Dry-run a version-pinned installation plan; never executes it.",inputSchema:{type:"object",properties:{framework:{type:"string"},os:{type:"string"},arch:{type:"string"}},required:["framework","os","arch"],additionalProperties:false}}
];
async function get(path,opts={}) {
 const u=new URL(path,controller);
 if(u.origin!==new URL(controller).origin)throw new Error("Invalid controller URL");
 const r=await fetch(u,{...opts,signal:AbortSignal.timeout(7000)});
 if(!r.ok)throw new Error("Controller returned HTTP "+r.status);
 return r.json();
}
async function call(name,args) {
 if(name==="tinkertunnel_status")return get("/api/internal/status",{headers:{authorization:"Bearer "+serviceToken}});
 if(name==="tinkertunnel_list_runners"){
   const s=await get("/api/internal/status",{headers:{authorization:"Bearer "+serviceToken}});
   return {runners:s.runners||[],jobExecution:"disabled"};
 }
 if(name==="tinkertunnel_framework_catalog")return get("/api/v1/catalog");
 if(name==="tinkertunnel_plan_install"){
   if(!args||typeof args!=="object"||Array.isArray(args)||!["framework","os","arch"].every(k=>typeof args[k]==="string"))throw new Error("framework, os, arch required");
   return get("/api/v1/plans",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({framework:args.framework,os:args.os,arch:args.arch})});
 }
 throw new Error("Unknown tool");
}
async function processMessage(message){
 if(!message || message.jsonrpc!=="2.0" || typeof message.method!=="string")return error(message?.id??null,-32600,"Invalid JSON-RPC request");
 if(!("id" in message))return null;
 const id=message.id;
 switch(message.method){
 case "initialize":return ok(id,{protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:"tinkertunnel-local",version:"0.1.0"}});
 case "ping":return ok(id,{});
 case "tools/list":return ok(id,{tools});
 case "tools/call":{
   const params=message.params||{},name=params.name;
   if(!tools.some(t=>t.name===name))return error(id,-32602,"Unknown tool");
   try{const result=await call(name,params.arguments||{});return ok(id,{content:[{type:"text",text:JSON.stringify(result)}],isError:false});}
   catch(e){return ok(id,{content:[{type:"text",text:"Tool unavailable: "+e.message}],isError:true});}
 }
 default:return error(id,-32601,"Method not found");
 }
}
createServer(async(req,res)=>{
 try {
   const pathname=new URL(req.url||"/","http://localhost").pathname;
   if(pathname==="/healthz"&&req.method==="GET")return send(res,200,{ok:true,authConfigured:bearer.length>=32});
   if(pathname!=="/mcp")return send(res,404,{error:"Not found"});
   if(!["POST","GET"].includes(req.method))return send(res,405,{error:"Method not allowed"},{allow:"POST, GET"});
   if(req.method==="GET")return send(res,405,{error:"SSE GET unsupported"},{allow:"POST"});
   const origin=req.headers.origin;
   if(origin&&!allowedOrigins.includes(origin))return send(res,403,{error:"Origin rejected"});
   if(bearer.length<32||serviceToken.length<32)return send(res,503,{error:"MCP gateway not configured"});
   if(!equal(req.headers.authorization||"","Bearer "+bearer))return send(res,401,{error:"Unauthorized"},{"www-authenticate":'Bearer realm="tinkertunnel-mcp"'});
   const accept=req.headers.accept||"";
   if(!accept.includes("application/json")||!accept.includes("text/event-stream"))return send(res,406,{error:"Accept must include application/json and text/event-stream"});
   if(!(req.headers["content-type"]||"").startsWith("application/json"))return send(res,415,{error:"JSON body required"});
   let raw="",length=0;
   for await (const chunk of req){length+=chunk.length;if(length>8192)return send(res,413,{error:"Request too large"});raw+=chunk;}
   let message;try{message=JSON.parse(raw);}catch{return send(res,400,error(null,-32700,"Invalid JSON"));}
   if(Array.isArray(message))return send(res,400,error(null,-32600,"Batch requests unsupported"));
   const result=await processMessage(message);
   if(result===null){res.writeHead(202,{"cache-control":"no-store"});return res.end();}
   return send(res,200,result);
 } catch(e){console.error("MCP error:",e.message);return send(res,500,{error:"Internal error"});}
}).listen(port,host,()=>console.log("TinkerTunnel MCP listening on "+host+":"+port));
