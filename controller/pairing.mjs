import {createPublicKey,verify,createHash,randomBytes} from "node:crypto";

const MAX_PENDING=25;
const TTL_MS=10*60*1000;
const validId=v=>typeof v==="string"&&/^[a-f0-9]{32}$/.test(v);
const validFingerprint=v=>typeof v==="string"&&/^SHA256:[A-Za-z0-9+/]{43}$/.test(v);
const allowed=v=>["linux","macos","windows"].includes(v);
const archAllowed=v=>["x64","arm64"].includes(v);
const fingerprint=publicKey=> "SHA256:"+createHash("sha256").update(publicKey).digest("base64").replace(/=+$/,"");
const challenge=()=>randomBytes(32).toString("hex");
const pending=(s)=>Array.isArray(s.pendingHostPairs)?s.pendingHostPairs:[];
const prune=(s)=>{s.pendingHostPairs=pending(s).filter(p=>p.expires>Date.now()&&p.status!=="delivered").slice(-MAX_PENDING);};

export async function publicHostPairRoute(req,ctx){
 const path=new URL(req.url).pathname;
 if(!["/api/host/pair/announce","/api/host/pair/poll"].includes(path)||req.method!=="POST")return null;
 const {state,save,body,reply,deny,limited,unseal}=ctx;
 if(!state().admin)return deny(409,"Controller setup is incomplete");
 // Public endpoints require strict bounds, rate limits and possession proofs.
 if(limited("host-pair-public",100))return deny(429,"Pairing rate limited");
 const b=await body(req);
 if(path.endsWith("/announce")){
  if(!allowed(b.os)||!archAllowed(b.arch)||typeof b.name!=="string"||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(b.name)||typeof b.publicKey!=="string"||
      b.publicKey.length>150||!b.publicKey.length)return deny(422,"Invalid host announcement");
  let publicKey;
  try{
   publicKey=Buffer.from(b.publicKey,"base64");
   const key=createPublicKey({key:publicKey,format:"der",type:"spki"});
   if(key.asymmetricKeyType!=="ed25519"||publicKey.length<40||publicKey.length>100)
    return deny(422,"Invalid host public key");
  }catch{return deny(422,"Invalid host public key");}
  const s=state();prune(s);
  if(s.pendingHostPairs.length>=MAX_PENDING)return deny(429,"Too many pending hosts");
  const id=randomBytes(16).toString("hex"),nonce=challenge();
  s.pendingHostPairs.push({id,name:b.name,os:b.os,arch:b.arch,publicKey:b.publicKey,
   fingerprint:fingerprint(publicKey),nonce,expires:Date.now()+TTL_MS,status:"pending",
   createdAt:new Date().toISOString()});
  save(s);
  return reply({id,nonce,expiresInSeconds:600});
 }
 if(!validId(b.id)||typeof b.signature!=="string"||b.signature.length>120)
  return deny(422,"Invalid pairing proof");
 const s=state();prune(s);
 const host=s.pendingHostPairs.find(p=>p.id===b.id);
 if(!host)return deny(404,"Pairing expired or unavailable");
 let authenticated=false;
 try{
  const key=createPublicKey({key:Buffer.from(host.publicKey,"base64"),format:"der",type:"spki"});
  authenticated=verify(null,Buffer.from("tinkertunnel-host-poll-v1\n"+host.id+"\n"+host.nonce),
    key,Buffer.from(b.signature,"base64"));
 }catch{}
 if(!authenticated)return deny(401,"Host identity proof failed");
 host.nonce=challenge(); // single-use challenge invalidates replay
 const approved=host.status==="approved";
 const token=approved?unseal(host.invite):null;
 if(approved){host.status="delivered";delete host.invite;}
 save(s);
 return reply({state:approved?"approved":"pending",nonce:host.nonce,
   expiresInSeconds:Math.max(0,Math.floor((host.expires-Date.now())/1000)),
   ...(approved?{enrollmentToken:token}:{} )});
}

export async function adminHostPairRoute(req,ctx){
 const path=new URL(req.url).pathname,method=req.method;
 if(!["/api/local/builders/pending","/api/local/builders/approve"].includes(path))return null;
 const {state,save,body,reply,deny,rnd,digest,seal,session,limited}=ctx;
 const s=state();prune(s);
 if(path.endsWith("/pending")&&method==="GET"){
  return reply({hosts:s.pendingHostPairs.map(({id,name,os,arch,fingerprint,status,createdAt,expires})=>({
   id,name,os,arch,fingerprint,status,createdAt,expiresAt:new Date(expires).toISOString()
  }))});
 }
 if(path.endsWith("/approve")&&method==="POST"){
  if(limited("host-pair-approve:"+session(req).username,20))return deny(429,"Too many approvals");
  const b=await body(req);
  if(!validId(b.id)||!validFingerprint(b.fingerprint)||b.confirmed!==true)
   return deny(422,"Verify the host fingerprint before approving");
  const host=s.pendingHostPairs.find(p=>p.id===b.id);
  if(!host)return deny(404,"Host announcement expired");
  if(host.status!=="pending")return deny(409,"Host already approved");
  if(host.fingerprint!==b.fingerprint)return deny(409,"Host fingerprint mismatch");
  const token=rnd();
  s.invites=(s.invites||[]).filter(i=>i.expires>Date.now());
  s.invites.push({hash:digest(token),expires:Date.now()+TTL_MS,
   hostFingerprint:host.fingerprint,hostName:host.name,hostOs:host.os,hostArch:host.arch});
  host.invite=seal(token);
  host.status="approved";
  host.approvedAt=new Date().toISOString();
  save(s);
  return reply({ok:true,id:host.id,status:"approved",fingerprint:host.fingerprint});
 }
 return deny(405,"Unsupported pairing operation");
}

export function verifyEnrolledPair(invite,b){
 if(!invite.hostFingerprint)return true; // legacy explicit one-time invitations
 if(typeof b.publicKey!=="string"||typeof b.signature!=="string")return false;
 try{
  const keyData=Buffer.from(b.publicKey,"base64");
  if(fingerprint(keyData)!==invite.hostFingerprint||
     b.name!==invite.hostName||b.os!==invite.hostOs||b.arch!==invite.hostArch)return false;
  const key=createPublicKey({key:keyData,format:"der",type:"spki"});
  return key.asymmetricKeyType==="ed25519"&&verify(null,
   Buffer.from("tinkertunnel-host-enroll-v1\n"+b.token+"\n"+b.name+"\n"+b.os+"\n"+b.arch),
   key,Buffer.from(b.signature,"base64"));
 }catch{return false;}
}
