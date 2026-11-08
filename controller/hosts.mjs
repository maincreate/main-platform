/** Controller-side mDNS host discovery and SSH pairing. No persistent OS passwords. */
import dgram from 'node:dgram';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const service='_maincreate._tcp.local';
const qname=s=>Buffer.concat([...s.split('.').map(part=>Buffer.concat([Buffer.from([part.length]),Buffer.from(part)])),Buffer.from([0])]);
export const validHost=host=>typeof host==='string'&&host.length<=253&&/^[a-z0-9][a-z0-9.-]*$/i.test(host)&&!host.includes('..');
export const validUser=user=>typeof user==='string'&&/^[a-z_][a-z0-9_-]{0,31}$/i.test(user);
function dnsName(b,offset,depth=0){
 if(depth>12)throw Error('DNS compression loop');
 const labels=[];let cursor=offset,end;
 for(let i=0;i<128;i++){
  if(cursor>=b.length)throw Error('Malformed DNS response');
  const n=b[cursor++];
  if((n&0xc0)===0xc0){
   if(cursor>=b.length)throw Error('Malformed pointer');
   const ptr=((n&0x3f)<<8)|b[cursor++];end??=cursor;
   const nested=dnsName(b,ptr,depth+1);
   labels.push(nested.name);return {name:labels.filter(Boolean).join('.'),next:end};
  }
  if(n===0)return {name:labels.join('.'),next:end??cursor};
  if(n>63||cursor+n>b.length)throw Error('Invalid DNS label');
  labels.push(b.toString('utf8',cursor,cursor+n));cursor+=n;
 }
 throw Error('DNS name too long');
}
export function parseDnsPacket(b){
 if(!Buffer.isBuffer(b)||b.length<12)return [];
 const count=b.readUInt16BE(6)+b.readUInt16BE(8)+b.readUInt16BE(10);let pos=12;
 try{
  for(let i=0;i<b.readUInt16BE(4);i++){pos=dnsName(b,pos).next+4;if(pos>b.length)return []}
  const records=[];
  for(let i=0;i<Math.min(count,100);i++){
   const key=dnsName(b,pos);pos=key.next;if(pos+10>b.length)break;
   const type=b.readUInt16BE(pos),length=b.readUInt16BE(pos+8);pos+=10;
   const end=pos+length;if(end>b.length)break;
   const record={owner:key.name.toLowerCase(),type};
   if(type===12||type===5)record.value=dnsName(b,pos).name.toLowerCase();
   if(type===33&&length>=6){record.port=b.readUInt16BE(pos+4);record.value=dnsName(b,pos+6).name.toLowerCase()}
   if(type===1&&length===4)record.address=[...b.subarray(pos,end)].join('.');
   records.push(record);pos=end;
  }
  return records;
 }catch{return []}
}
export async function discoverHosts({timeoutMs=2200}={}){
 const socket=dgram.createSocket({type:'udp4',reuseAddr:true});const records=[];
 try{
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'0.0.0.0',resolve)});
  socket.on('message',packet=>records.push(...parseDnsPacket(packet)));
  try{socket.addMembership('224.0.0.251')}catch{}
  const query=Buffer.concat([Buffer.from([0,0,0,0,0,1,0,0,0,0,0,0]),qname(service),Buffer.from([0,12,0x80,1])]);
  await new Promise((resolve,reject)=>socket.send(query,5353,'224.0.0.251',err=>err?reject(err):resolve()));
  await new Promise(resolve=>setTimeout(resolve,Math.max(500,Math.min(5000,timeoutMs))));
  const instances=[...new Set(records.filter(r=>r.owner===service&&r.type===12).map(r=>r.value))];
  return instances.map(instance=>{
   const srv=records.find(r=>r.owner===instance&&r.type===33);
   const addr=records.find(r=>r.owner===srv?.value&&r.type===1);
   return {name:instance.split('._maincreate.')[0],hostname:srv?.value||null,address:addr?.address||null,port:srv?.port||22};
  }).filter(item=>item.hostname&&item.port===22).slice(0,50);
 }finally{socket.close()}
}
function execBounded(command,args,{input='',env={},timeout=12000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe'],windowsHide:true});
  let out='',err='',settled=false;
  const fail=e=>{if(settled)return;settled=true;clearTimeout(timer);reject(e)};
  const timer=setTimeout(()=>{child.kill('SIGKILL');fail(Error('Host connection timed out'))},timeout);
  child.on('error',fail);
  child.stdout.on('data',chunk=>out=(out+chunk).slice(-8192));
  child.stderr.on('data',chunk=>err=(err+chunk).slice(-2048));
  child.on('close',code=>{
   if(settled)return;settled=true;clearTimeout(timer);
   code===0?resolve({stdout:out,stderr:err}):reject(Error('Host command failed (status '+code+'): '+err.replace(/password.*/ig,'authentication failed').slice(-400)))
  });
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
export async function hostFingerprint(host){
 if(!validHost(host))throw Error('Invalid host');
 const scan=await execBounded('ssh-keyscan',['-T','5','-t','ed25519',host],{timeout:9000});
 const line=scan.stdout.split(/\r?\n/).find(x=>/^\S+ ssh-ed25519 [A-Za-z0-9+/=]+/.test(x));
 if(!line)throw Error('No SSH Ed25519 host key found');
 const key=line.trim().split(/\s+/)[2];
 const digest=createHash('sha256').update(Buffer.from(key,'base64')).digest('base64').replace(/=+$/,'');
 return {host,fingerprint:'SHA256:'+digest,knownHostLine:line};
}
export async function pairOverSsh({host,username,password,fingerprint,controller,invitation}){
 if(!validHost(host)||!validUser(username)||typeof password!=='string'||password.length<1||password.length>200)throw Error('Invalid host credentials');
 if(!/^SHA256:[A-Za-z0-9+/]+$/.test(fingerprint)||!/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(controller)||typeof invitation!=='string'||invitation.length<32)throw Error('Invalid pairing request');
 const current=await hostFingerprint(host);
 if(current.fingerprint!==fingerprint)throw Error('SSH host fingerprint changed. Refusing to send credentials.');
 const tmp=await mkdtemp(join(tmpdir(),'maincreate-ssh-'));const known=join(tmp,'known_hosts');
 try{
  await writeFile(known,current.knownHostLine+'\n',{mode:0o600});
  const args=['-e','ssh','-T','-p','22','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,'-o','PreferredAuthentications=password,keyboard-interactive','-o','PubkeyAuthentication=no','-o','ConnectTimeout=8',username+'@'+host,'sudo -n /usr/local/bin/maincreate-host join'];
  const result=await execBounded('sshpass',args,{input:JSON.stringify({controller,invitation})+'\n',env:{SSHPASS:password},timeout:30000});
  const id=/\(ID ([0-9a-f]{24})\)/.exec(result.stdout)?.[1];
  if(!id)throw Error('Host did not confirm enrollment');
  return {runnerId:id,host,fingerprint};
 }finally{await rm(tmp,{recursive:true,force:true})}
}
