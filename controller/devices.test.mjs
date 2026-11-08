import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const dir=mkdtempSync(join(tmpdir(),"maincreate-device-inventory-"));
process.env.MAIN_DATA_DIR=dir;
const {reportDevices,listDevices,renameDevice}=await import("./devices.mjs");
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
