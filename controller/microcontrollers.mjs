import {readFileSync} from "node:fs";
const reference=JSON.parse(readFileSync(new URL("../registry/microcontrollers.json",import.meta.url),"utf8"));
export function microcontrollerCatalog(){
 return {schema:reference.schema,catalogRevision:reference.catalogRevision,policy:reference.policy,
  families:reference.families.map(({usb,...family})=>({...family,usbIdentifiers:usb}))};
}
export function compatibilityForDevice(device){
 const vid=device?.vid,pid=device?.pid;
 const candidates=reference.families.flatMap(family=>
  family.usb.filter(u=>u.vid===vid&&u.pid===pid).map(match=>({
   familyId:family.id,familyName:family.name,candidateChips:family.chips,
   evidence:match.evidence,confidence:match.confidence,
   sdk:family.sdk.map(s=>({...s})),verification:family.probe,
   sources:family.sources
  })));
 // VID/PID matches a USB interface, not a complete board identity.
 return {deviceId:device?.id||null,identification:"usb-descriptor-only",
  verifiedChip:null,verifiedBoard:null,flashReady:false,
  candidates,unknown:candidates.length===0,
  note:candidates.length?"USB descriptors suggest a microcontroller family. A read-only chip probe is still required before flashing.":
    "USB descriptors do not identify a supported microcontroller. A read-only chip probe is required."};
}
