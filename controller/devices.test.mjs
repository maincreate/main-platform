import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const dir=mkdtempSync(join(tmpdir(),"maincreate-device-inventory-"));
process.env.MAIN_DATA_DIR=dir;
const {reportDevices,listDevices,renameDevice,findDevice}=await import("./devices.mjs");
const DAY=86400_000;
const start=Date.parse("2026-11-01T12:00:00Z");
const runner={id:"runner-one",name:"pi-builder",os:"linux"};
const sample={port:"/dev/ttyACM0",vid:0x303a,pid:0x1001,
 serialNumber:"ABC123",location:"1-2",manufacturer:"Espressif",product:"USB JTAG/serial"};
test.after(()=>rmSync(dir,{recursive:true,force:true}));

test("USB inventory returns stable hardware identity, builder and serial port",()=>{
 const summary=reportDevices(runner,[sample],start);
 assert.equal(summary.new,1);
 const device=listDevices({},start).devices[0];
 assert.equal(device.runnerId,runner.id);
 assert.equal(device.port,"/dev/ttyACM0");
 assert.equal(device.identityConfidence,"serial");
 assert.equal(device.lifecycle,"connected");
 assert.equal(device.flashEligible,false);
 assert.equal(device.chipVerified,false);
 assert.equal(renameDevice(device.id,"Waymarker Dial").label,"Waymarker Dial");
});
test("disconnection immediately shows offline without erasing history",()=>{
 reportDevices(runner,[],start+60000);
 const d=listDevices({},start+60000).devices[0];
 assert.equal(d.connected,false);
 assert.equal(d.lifecycle,"offline");
 assert.equal(d.label,"Waymarker Dial");
});
test("hidden at seven days, archived at thirty and automatically restored on return",()=>{
 const visible=listDevices({},start+6*DAY);
 assert.equal(visible.devices.length,1);
 assert.equal(listDevices({},start+8*DAY).devices.length,0);
 assert.equal(listDevices({mode:"hidden"},start+8*DAY).devices.length,1);
 assert.equal(listDevices({mode:"archived"},start+31*DAY).devices.length,1);
 assert.equal(listDevices({mode:"all"},start+31*DAY).devices.length,1);
 const restored=reportDevices(runner,[{...sample,port:"/dev/ttyACM1"}],start+32*DAY);
 assert.equal(restored.new,0);
 assert.equal(restored.restored,1);
 const d=listDevices({},start+32*DAY).devices[0];
 assert.equal(d.port,"/dev/ttyACM1");
 assert.equal(d.firstSeen,"2026-11-01T12:00:00.000Z");
 assert.equal(d.lifecycle,"connected");
 assert.equal(d.label,"Waymarker Dial");
});
test("location-only identity isn't approved for automatic flashing",()=>{
 const d=reportDevices(runner,[{...sample,serialNumber:null}],start+33*DAY);
 assert.equal(d.new,1);
 const list=listDevices({},start+33*DAY).devices;
 assert.equal(list.length,2);
 assert.equal(list.find(x=>x.identityConfidence==="location").flashEligible,false);
});
test("invalid serial paths and reports cannot update inventory",()=>{
 assert.throws(()=>reportDevices(runner,[{...sample,port:"../../etc/passwd"}],start+34*DAY),/Invalid serial port/);
 assert.throws(()=>reportDevices(runner,[{...sample,port:"/dev/ttyACM0\n"}],start+34*DAY),/Invalid serial port/);
 assert.throws(()=>reportDevices(runner,Array(49).fill(sample),start+34*DAY),/Invalid device report/);
});

test("same hardware serial survives builder re-enrollment and physical port changes",()=>{
 const first=reportDevices(runner,[{...sample,serialNumber:"44:bd:8d:78:15:e8"}],start+35*DAY);
 assert.equal(first.new,1);
 const original=listDevices({mode:"all"},start+35*DAY).devices.find(d=>d.serialNumber==="44:BD:8D:78:15:E8");
 assert.ok(original);
 renameDevice(original.id,"Original ESP32 profile");
 const reenrolled={id:"runner-reregistered",name:"pi-builder",os:"linux"};
 const second=reportDevices(reenrolled,[{...sample,serialNumber:"44:BD:8D:78:15:E8",
  port:"/dev/ttyACM3",pid:0x1002,interface:"new-interface"}],start+35*DAY+10000);
 assert.equal(second.new,0,"Serial must remain one physical device even if runner and PID change");
 const current=listDevices({mode:"all"},start+35*DAY+10000).devices.filter(d=>d.serialNumber==="44:BD:8D:78:15:E8");
 assert.equal(current.length,1);
 assert.equal(current[0].id,original.id);
 assert.equal(current[0].firstSeen,original.firstSeen);
 assert.equal(current[0].label,"Original ESP32 profile");
 assert.equal(current[0].runnerId,reenrolled.id);
 assert.equal(current[0].port,"/dev/ttyACM3");
 assert.equal(current[0].pid,0x1002);
 // The previously registered builder must not disconnect the device now on another builder.
 reportDevices(runner,[],start+35*DAY+20000);
 assert.equal(listDevices({mode:"all"},start+35*DAY+20000).devices.find(d=>d.id===original.id).connected,true);
});

test("historical duplicate rows merge into the original profile without losing references",()=>{
 const file=join(dir,"devices.json");
 const state=JSON.parse(readFileSync(file,"utf8"));
 const original=state.records.find(d=>d.serialNumber==="44:BD:8D:78:15:E8");
 const oldId=original.id;
 const duplicateId="a".repeat(32);
 const latest=new Date(start+35*DAY+30000).toISOString();
 state.records.push({...original,id:duplicateId,runnerId:"runner-reinstalled",
  runnerName:"pi-builder",port:"/dev/ttyACM0",label:null,firstSeen:latest,lastSeen:latest,connected:true});
 writeFileSync(file,JSON.stringify(state));
 // A GET must reconcile the existing on-disk duplicate without waiting for a new USB scan.
 const rows=listDevices({mode:"all"},start+35*DAY+30000).devices.filter(d=>d.serialNumber==="44:BD:8D:78:15:E8");
 assert.equal(rows.length,1);
 assert.equal(rows[0].id,oldId,"Oldest physical device profile ID must win");
 assert.equal(rows[0].label,"Original ESP32 profile");
 assert.equal(rows[0].runnerId,"runner-reinstalled");
 assert.equal(rows[0].port,"/dev/ttyACM0");
 assert.ok(rows[0].aliases.includes(duplicateId));
 assert.equal(findDevice(duplicateId).id,oldId);
 const persisted=JSON.parse(readFileSync(file,"utf8"));
 assert.equal(persisted.records.filter(d=>d.serialNumber==="44:BD:8D:78:15:E8").length,1);
 assert.equal(persisted.aliases[duplicateId],oldId);
 assert.equal(persisted.mergedRecords.find(d=>d.id===duplicateId)?.mergedInto,oldId);
 assert.equal(renameDevice(duplicateId,"Restored custom profile").id,oldId);
 assert.equal(findDevice(oldId).label,"Restored custom profile");
});

test("multiple interfaces reporting the same serial produce only one logical device",()=>{
 const host={id:"runner-reinstalled",name:"pi-builder",os:"linux"};
 const report=reportDevices(host,[
  {...sample,serialNumber:"44:BD:8D:78:15:E8",port:"/dev/ttyACM0",interface:"0"},
  {...sample,serialNumber:"44:BD:8D:78:15:E8",port:"/dev/ttyACM1",interface:"1"}
 ],start+35*DAY+40000);
 assert.equal(report.seen,1);
 assert.equal(report.new,0);
 assert.equal(listDevices({mode:"all"},start+35*DAY+40000).devices.filter(d=>d.serialNumber==="44:BD:8D:78:15:E8").length,1);
});
