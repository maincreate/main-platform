import {createHash,randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,renameSync,chmodSync,existsSync} from "node:fs";
import {join} from "node:path";

const dir=process.env.MAIN_DATA_DIR||"./.maincreate-data";
const file=join(dir,"devices.json");
const DAY=24*60*60*1000;
const MAX_DEVICES=500,MAX_REPORTED=48;
const err=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash("sha256").update(value).digest("hex").slice(0,32);
const bounded=(s,max=120)=>typeof s==="string"&&s.length>0&&s.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(s);
/** One physical USB serial identifies one device; builder/port/interface are observations.
 * Normalize MAC-shaped Espressif serials, but preserve case of arbitrary vendor serials.
 */
const serialIdentity=value=>{
 if(!bounded(value,120))return null;
 const serial=value.trim();
 if(!serial)return null;
 return /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(serial)?serial.toUpperCase():serial;
};
const time=value=>{const n=Date.parse(value||"");return Number.isFinite(n)?n:0;};
function resolveAlias(state,id){
 const seen=new Set();
 while(state.aliases?.[id]&&!seen.has(id)){seen.add(id);id=state.aliases[id];}
 return id;
}
/** Consolidate records from prior builder-scoped identities on first read.
 * Retain the oldest profile ID/firstSeen/label, newest live connection and all
 * superseded records in an audit archive. Old IDs remain usable as aliases.
 */
function reconcile(state){
 const groups=new Map();
 state.records.forEach((record,index)=>{
  const serial=serialIdentity(record.serialNumber);
  if(serial){
   const group=groups.get(serial)||[];
   group.push({record,index});groups.set(serial,group);
  }
 });
 let changed=false;
 const removed=new Set();
 for(const [serial,group] of groups){
  if(group.length<2)continue;
  const byAge=[...group].sort((a,b)=>(time(a.record.firstSeen)||Number.MAX_SAFE_INTEGER)-
   (time(b.record.firstSeen)||Number.MAX_SAFE_INTEGER)||a.index-b.index);
  const primary=byAge[0].record;
  const latest=[...group].sort((a,b)=>time(b.record.lastSeen)-time(a.record.lastSeen)||
   Number(b.record.connected)-Number(a.record.connected)||b.index-a.index)[0].record;
  const firstSeen=primary.firstSeen;
  const label=primary.label||byAge.find(x=>x.record.label)?.record.label||null;
  // Copy the newest observation, never its separate physical record ID.
  for(const field of ["runnerId","runnerName","port","description","manufacturer","product",
   "vid","pid","location","interface","connected","lastSeen"]){
   primary[field]=latest[field];
  }
  primary.firstSeen=firstSeen;
  primary.label=label;
  primary.serialNumber=serial;
  primary.identityConfidence="serial";
  state.aliases??={};
  state.mergedRecords??=[];
  for(const {record} of group){
   if(record===primary)continue;
   removed.add(record);
   state.aliases[record.id]=primary.id;
   state.mergedRecords.push({...record,mergedInto:primary.id,mergedAt:new Date().toISOString()});
  }
  changed=true;
 }
 if(changed){
  state.records=state.records.filter(d=>!removed.has(d));
  // Existing route IDs may point to an earlier alias: preserve full resolution chain.
  for(const [id] of Object.entries(state.aliases))state.aliases[id]=resolveAlias(state,id);
 }
 return changed;
}
const hex=(n)=>Number.isInteger(n)&&n>=0&&n<=65535?n:null;
const portValid=(s,os)=>bounded(s,128)&&(os==="windows"?/^COM[0-9]{1,4}$/i.test(s):
  /^\/dev\/(?:tty|cu\.|serial\/by-id\/)[A-Za-z0-9._/\-]+$/.test(s)&&!s.includes(".."));
function load(){
 if(!existsSync(file))return {version:1,records:[],observations:[]};
 const state=JSON.parse(readFileSync(file,"utf8"));
 if(state.version!==1||!Array.isArray(state.records))throw err(503,"Device inventory unavailable");
 state.observations??=[];
 if(reconcile(state))save(state);
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
const clean=(d,now=Date.now(),aliases=[])=>({
 id:d.id,aliases,runnerId:d.runnerId,runnerName:d.runnerName,port:d.port,
 description:d.description,manufacturer:d.manufacturer,product:d.product,vid:d.vid,pid:d.pid,
 serialNumber:d.serialNumber||null,location:d.location||null,interface:d.interface||null,
 identityConfidence:d.identityConfidence,firstSeen:d.firstSeen,lastSeen:d.lastSeen,
 connected:lifecycle(d,now)==="connected",lifecycle:lifecycle(d,now),label:d.label||null,
 flashEligible:false,chipVerified:false
});
export function reportDevices(runner,raw,now=Date.now()){
 if(!Array.isArray(raw)||raw.length>MAX_REPORTED)throw err(422,"Invalid device report");
 const scanned=[],keys=new Set();
 for(const item of raw){
  if(!item||typeof item!=="object"||Array.isArray(item))throw err(422,"Invalid device");
  if(!portValid(item.port,runner.os))throw err(422,"Invalid serial port");
  const vid=hex(item.vid),pid=hex(item.pid);
  if(vid===null||pid===null)continue;
  const serial=serialIdentity(item.serialNumber);
  const loc=bounded(item.location,120)?item.location:null;
  const iface=bounded(item.interface,80)?item.interface:null;
  const confidence=serial?"serial":loc?"location":"port";
  const identity=serial?"serial:"+serial:loc?"location:"+loc:"port:"+item.port;
  // Serial identity is global. Unidentified endpoints stay scoped to the builder.
  const id=serial?hash("usb-serial|"+serial):hash([runner.id,vid,pid,identity,iface||""].join("|"));
  const key=serial?"serial:"+serial:"id:"+id;
  if(keys.has(key))continue;keys.add(key);
  scanned.push({id,runnerId:runner.id,runnerName:runner.name,port:item.port,
   description:bounded(item.description,160)?item.description:"USB serial device",
   manufacturer:bounded(item.manufacturer,120)?item.manufacturer:null,
   product:bounded(item.product,120)?item.product:null,
   vid,pid,serialNumber:serial,location:loc,interface:iface,identityConfidence:confidence});
 }
 const state=load(),timestamp=new Date(now).toISOString();
 // Reuse the ORIGINAL device profile ID, even after builder re-enrollment.
 const matched=scanned.map(device=>({
  device,old:state.records.find(d=>device.serialNumber&&serialIdentity(d.serialNumber)===device.serialNumber)||
    state.records.find(d=>d.id===device.id)
 }));
 const observed=new Set(matched.map(({device,old})=>old?.id||device.id));
 for(const old of state.records){
  if(old.runnerId===runner.id&&!observed.has(old.id))old.connected=false;
 }
 let restored=0,added=0;
 for(const {device,old} of matched){
  if(old){
   if(lifecycle(old,now)==="archived")restored++;
   Object.assign(old,device,{id:old.id,lastSeen:timestamp,connected:true});
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
 .map(d=>clean(d,now,Object.keys(state.aliases||{}).filter(id=>resolveAlias(state,id)===d.id)));
 const byState={connected:0,offline:0,hidden:0,archived:0};
 for(const d of state.records)byState[lifecycle(d,now)]++;
 return {devices:records,summary:{total:state.records.length,...byState},
  policy:{hideAfterDays:7,archiveAfterDays:30,autoRestore:true,
   flashRequiresStableSerial:true,flashRequiresVerifiedChip:true,flashingEnabled:false}};
}
export function findDevice(id){
 const state=load();
 return state.records.find(d=>d.id===resolveAlias(state,id))||null;
}
export function renameDevice(id,label){
 if(typeof id!=="string"||!/^[a-f0-9]{32}$/.test(id))throw err(422,"Invalid device ID");
 if(label!==""&&(!bounded(label,80)))throw err(422,"Invalid label");
 const state=load(),device=state.records.find(d=>d.id===resolveAlias(state,id));
 if(!device)throw err(404,"Device not found");
 device.label=label||null;save(state);
 return clean(device,Date.now(),Object.keys(state.aliases||{}).filter(key=>resolveAlias(state,key)===device.id));
}
export function deviceOverview(){
 const {summary}=listDevices({mode:"visible"});
 return {count:summary.total,online:summary.connected,offline:summary.offline,
  hidden:summary.hidden,archived:summary.archived};
}
