import {createHash,randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,renameSync,chmodSync,existsSync} from "node:fs";
import {join} from "node:path";

const dir=process.env.TT_DATA_DIR||"./.tinkertunnel-data";
const file=join(dir,"devices.json");
const DAY=24*60*60*1000;
const MAX_DEVICES=500,MAX_REPORTED=48;
const err=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash("sha256").update(value).digest("hex").slice(0,32);
const bounded=(s,max=120)=>typeof s==="string"&&s.length>0&&s.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(s);
const hex=(n)=>Number.isInteger(n)&&n>=0&&n<=65535?n:null;
const portValid=(s,os)=>bounded(s,128)&&(os==="windows"?/^COM[0-9]{1,4}$/i.test(s):
  /^\/dev\/(?:tty|cu\.|serial\/by-id\/)[A-Za-z0-9._/\-]+$/.test(s)&&!s.includes(".."));
function load(){
 if(!existsSync(file))return {version:1,records:[],observations:[]};
 const state=JSON.parse(readFileSync(file,"utf8"));
 if(state.version!==1||!Array.isArray(state.records))throw err(503,"Device inventory unavailable");
 state.observations??=[];
 return state;
}
function save(s){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const tmp=join(dir,".device-"+randomBytes(12).toString("hex"));
 writeFileSync(tmp,JSON.stringify(s),{mode:0o600,flag:"wx"});
 renameSync(tmp,file);chmodSync(file,0o600);
}
const lifecycle=(d,now=Date.now())=>{
 const age=now-Date.parse(d.lastSeen);
 if(d.connected&&age<=120000)return "connected";
 if(age>=30*DAY)return "archived";
 if(age>=7*DAY)return "hidden";
 return "offline";
};
const clean=(d,now=Date.now())=>({
 id:d.id,runnerId:d.runnerId,runnerName:d.runnerName,port:d.port,
 description:d.description,manufacturer:d.manufacturer,product:d.product,vid:d.vid,pid:d.pid,
 serialNumber:d.serialNumber||null,location:d.location||null,interface:d.interface||null,
 identityConfidence:d.identityConfidence,firstSeen:d.firstSeen,lastSeen:d.lastSeen,
 connected:lifecycle(d,now)==="connected",lifecycle:lifecycle(d,now),label:d.label||null,
 flashEligible:d.identityConfidence==="serial"&&lifecycle(d,now)==="connected"
});
export function reportDevices(runner,raw,now=Date.now()){
 if(!Array.isArray(raw)||raw.length>MAX_REPORTED)throw err(422,"Invalid device report");
 const scanned=[],keys=new Set();
 for(const item of raw){
  if(!item||typeof item!=="object"||Array.isArray(item))throw err(422,"Invalid device");
  if(!portValid(item.port,runner.os))throw err(422,"Invalid serial port");
  const vid=hex(item.vid),pid=hex(item.pid);
  if(vid===null||pid===null)continue; // Only USB-identifiable ports, not arbitrary pseudo-terminals.
  const serial=bounded(item.serialNumber,120)?item.serialNumber:null;
  const loc=bounded(item.location,120)?item.location:null;
  const iface=bounded(item.interface,80)?item.interface:null;
  // Device identity is scoped by runner. A USB location is less trustworthy than a unique serial.
  const confidence=serial?"serial":loc?"location":"port";
  const identity=serial?"serial:"+serial:loc?"location:"+loc:"port:"+item.port;
  const id=hash([runner.id,vid,pid,identity,iface||""].join("|"));
  if(keys.has(id))continue;keys.add(id);
  scanned.push({id,runnerId:runner.id,runnerName:runner.name,port:item.port,
   description:bounded(item.description,160)?item.description:"USB serial device",
   manufacturer:bounded(item.manufacturer,120)?item.manufacturer:null,
   product:bounded(item.product,120)?item.product:null,
   vid,pid,serialNumber:serial,location:loc,interface:iface,identityConfidence:confidence});
 }
 const state=load(),timestamp=new Date(now).toISOString();
 const observed=new Set(scanned.map(d=>d.id));
 for(const old of state.records){
  if(old.runnerId===runner.id&&!observed.has(old.id))old.connected=false;
 }
 let restored=0,added=0;
 for(const device of scanned){
  const old=state.records.find(d=>d.id===device.id);
  if(old){
   if(lifecycle(old,now)==="archived")restored++;
   Object.assign(old,device,{lastSeen:timestamp,connected:true});
  }else{
   if(state.records.length>=MAX_DEVICES)throw err(409,"Device inventory capacity reached");
   state.records.push({...device,firstSeen:timestamp,lastSeen:timestamp,connected:true,label:null});added++;
  }
 }
 state.observations.push({runnerId:runner.id,at:timestamp,count:scanned.length});
 state.observations=state.observations.slice(-500);
 save(state);
 return {seen:scanned.length,new:added,restored};
}
export function listDevices(args={},now=Date.now()){
 const state=load();const mode=args.mode||"visible";
 if(!["visible","all","hidden","archived"].includes(mode))throw err(422,"Invalid inventory view");
 const records=state.records.map(d=>({...d,lifecycle:lifecycle(d,now)}))
 .filter(d=>(!args.runnerId||d.runnerId===args.runnerId)&&
 (mode==="all"|| (mode==="visible"?!["hidden","archived"].includes(d.lifecycle):
   d.lifecycle===mode)))
 .sort((a,b)=>Date.parse(b.lastSeen)-Date.parse(a.lastSeen))
 .map(d=>clean(d,now));
 const byState={connected:0,offline:0,hidden:0,archived:0};
 for(const d of state.records)byState[lifecycle(d,now)]++;
 return {devices:records,summary:{total:state.records.length,...byState},
  policy:{hideAfterDays:7,archiveAfterDays:30,autoRestore:true,
   flashRequiresStableSerial:true}};
}
export function findDevice(id){return load().records.find(d=>d.id===id)||null;}
export function renameDevice(id,label){
 if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id))throw err(422,"Invalid device ID");
 if(label!==""&&(!bounded(label,80)))throw err(422,"Invalid label");
 const state=load(),device=state.records.find(d=>d.id===id);
 if(!device)throw err(404,"Device not found");
 device.label=label||null;save(state);return clean(device);
}
export function deviceOverview(){
 const {summary}=listDevices({mode:"visible"});
 return {count:summary.total,online:summary.connected,offline:summary.offline,
  hidden:summary.hidden,archived:summary.archived};
}
