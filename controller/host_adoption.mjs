import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const fail=(status,message)=>Object.assign(new Error(message),{status});
const shell=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
export function parseHost(address,username){
 if(typeof address!=="string"||address.length>255||typeof username!=="string"||
   !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(username)||username==="root")
   throw fail(422,"Provide a host and a non-root SSH username with sudo access");
 let url;try{url=new URL(address.startsWith("ssh://")?address:"ssh://"+address);}catch{throw fail(422,"Invalid SSH address");}
 if(url.protocol!=="ssh:"||!url.hostname||url.username||url.password||url.pathname!=="/"||url.search||url.hash)
  throw fail(422,"SSH address must not include a path or embedded credentials");
 const port=url.port?Number(url.port):22;
 if(!Number.isInteger(port)||port<1||port>65535)throw fail(422,"Invalid SSH port");
 return {host:url.hostname.replace(/^\[|\]$/g,""),port,username};
}
export const sshFingerprint=key=>"SHA256:"+createHash("sha256").update(key).digest("base64").replace(/=+$/,"");
async function connect(config,approved,password){
 const {Client}=await import("ssh2");
 return new Promise((resolve,reject)=>{
  const conn=new Client();let done=false,seen=null;
  const finish=(err,result)=>{if(done)return;done=true;if(err){conn.end();reject(err);}else resolve(result);};
  conn.once("ready",()=>finish(null,conn));
  conn.once("error",e=>{if(!approved&&seen)return finish(null,{fingerprint:seen});finish(fail(502,"SSH connection failed: "+String(e.message).slice(0,130)));});
  conn.once("close",()=>{if(!approved&&seen)finish(null,{fingerprint:seen});});
  conn.connect({...config,readyTimeout:15000,
   ...(approved?{password}:{}),hostVerifier:key=>{
    seen=sshFingerprint(key);
    return approved?seen===approved:false;
   }});
 });
}
export function inspectHost(address,username){return connect(parseHost(address,username),null,null);}
function execute(conn,command,input="",ms=120000){
 return new Promise((resolve,reject)=>{
  let done=false,output="",errors="";
  const timer=setTimeout(()=>{conn.end();if(!done){done=true;reject(fail(504,"Remote operation timed out"));}},ms);
  conn.exec(command,(err,stream)=>{
   if(err){clearTimeout(timer);done=true;return reject(fail(502,"Remote SSH command unavailable"));}
   stream.on("data",d=>{output+=String(d);if(output.length>16000)conn.end();});
   stream.stderr.on("data",d=>{errors+=String(d);if(errors.length>16000)conn.end();});
   stream.once("close",code=>{
    if(done)return;done=true;clearTimeout(timer);
    if(code!==0)return reject(fail(502,"Remote setup failed ("+code+"): "+errors.slice(-260)));
    resolve(output.trim());
   });
   stream.end(input);
  });
 });
}
async function sudo(conn,cmd,password){return execute(conn,"sudo -S -p '' -- "+cmd,password+"\n",60000);}
async function copy(conn,local,remote){
 const sftp=await new Promise((resolve,reject)=>conn.sftp((err,channel)=>err?reject(err):resolve(channel)));
 await new Promise((resolve,reject)=>sftp.fastPut(local,remote,err=>err?reject(err):resolve()));
}
async function officialRelease(arch){
 const response=await fetch("https://api.github.com/repos/actions/runner/releases/latest",{
  headers:{"accept":"application/vnd.github+json","user-agent":"TinkerTunnel"},signal:AbortSignal.timeout(14000)});
 if(!response.ok)throw fail(502,"Official GitHub runner release unavailable");
 const release=await response.json();
 const item=release.assets?.find(a=>new RegExp("^actions-runner-linux-"+arch+"-.*[.]tar[.]gz$").test(a.name));
 if(!item||!/^sha256:[a-f0-9]{64}$/i.test(item.digest||"")||
    !item.browser_download_url?.startsWith("https://github.com/actions/runner/releases/download/"))
   throw fail(502,"Runner release lacks a verified archive for linux-"+arch);
 return {name:item.name,url:item.browser_download_url,digest:item.digest.slice(7)};
}
export async function enrollHost({address,username,password,approvedFingerprint,organization,controllerUrl,progress,getToken,getInvite}){
 if(typeof password!=="string"||!password||password.length>2048)throw fail(422,"SSH password required");
 if(!/^SHA256:[A-Za-z0-9+/]{40,50}$/.test(approvedFingerprint||""))throw fail(422,"Confirm the SSH fingerprint first");
 if(!/^[A-Za-z0-9-]{1,39}$/.test(organization||""))throw fail(422,"GitHub organization required");
 const url=new URL(controllerUrl);
 if(url.protocol!=="https:")throw fail(422,"A publicly reachable HTTPS controller URL is required");
 let conn;
 try{
  progress("Connecting to verified host");
  conn=await connect(parseHost(address,username),approvedFingerprint,password);
  const info=(await execute(conn,"uname -s; uname -m; hostname -s; printf '%s\\n' \"$HOME\"")).split("\n");
  const arch=info[1]==="aarch64"?"arm64":info[1]==="x86_64"?"x64":null;
  if(info[0]!=="Linux"||!arch)throw fail(422,"Automatic enrollment currently supports Linux ARM64/x64");
  const name=("tt-"+info[2].replace(/[^a-zA-Z0-9._-]/g,"-")).slice(0,60),home=info[3];
  if(typeof home!=="string"||!home.startsWith("/")||home.includes("..")||!/^[A-Za-z0-9_./-]+$/.test(home))
   throw fail(502,"Unexpected home path on host");
  const base=home+"/.tinkertunnel";
  progress("Inspecting build host");
  await execute(conn,"command -v bash; command -v curl; command -v tar; command -v sha256sum; command -v sudo; command -v node");
  const major=Number(await execute(conn,"node -p 'process.versions.node.split(\".\")[0]'"));
  if(!Number.isInteger(major)||major<22)throw fail(422,"Node.js 22 or newer is required on the host");
  await execute(conn,"mkdir -p "+shell(base)+" && chmod 700 "+shell(base));
  progress("Downloading verified GitHub Actions runner");
  const asset=await officialRelease(arch),runnerDir=base+"/actions-runner";
  const installation=[
   "set -euo pipefail",
   "mkdir -p "+shell(runnerDir),
   "cd "+shell(runnerDir),
   "if [ ! -f .runner ]; then",
   "curl -fLsS --retry 2 "+shell(asset.url)+" -o "+shell(asset.name),
   "printf '%s  %s\\n' "+shell(asset.digest)+" "+shell(asset.name)+" | sha256sum -c -",
   "tar -xzf "+shell(asset.name),
   "rm -f "+shell(asset.name),
   "fi"
  ].join("\n")+"\n";
  await execute(conn,"bash -se",installation,180000);
  progress("Registering with GitHub Actions");
  const regToken=await getToken(),labels=["tt-managed","tt-linux","tt-"+arch];
  const registration=[
   "set -euo pipefail","cd "+shell(runnerDir),
   "if [ -f .runner ]; then grep -Fq "+shell(organization)+" .runner || { echo 'Runner already registered elsewhere' >&2; exit 1; };",
   "else ./config.sh --unattended --url "+shell("https://github.com/"+organization)+
     " --token "+shell(regToken)+" --name "+shell(name)+" --labels "+shell(labels.join(","))+" --work _work",
   "fi"
  ].join("\n")+"\n";
  await execute(conn,"bash -se",registration,110000);
  progress("Starting Actions runner service");
  await sudo(conn,shell(runnerDir+"/svc.sh")+" install "+shell(username),password);
  await sudo(conn,shell(runnerDir+"/svc.sh")+" start",password);
  progress("Installing TinkerTunnel companion");
  await copy(conn,fileURLToPath(new URL("../runner/agent.mjs",import.meta.url)),base+"/agent.mjs");
  await copy(conn,fileURLToPath(new URL("../runner/scan_devices.py",import.meta.url)),base+"/scan_devices.py");
  const invite=await getInvite();
  await execute(conn,"bash -se","TT_CONTROLLER_URL="+shell(url.origin)+" TT_ENROLLMENT_TOKEN="+shell(invite)+" node "+shell(base+"/agent.mjs")+" enroll\n",30000);
  const nodeBin=await execute(conn,"command -v node");
  const service="tinkertunnel-"+name.slice(3).toLowerCase()+".service";
  const unit=["[Unit]","Description=TinkerTunnel managed companion","After=network-online.target",
   "[Service]","Type=simple","User="+username,"WorkingDirectory="+base,
   "Environment=TT_CONTROLLER_URL="+url.origin,"ExecStart="+nodeBin+" "+base+"/agent.mjs run",
   "Restart=always","RestartSec=10","NoNewPrivileges=true","[Install]","WantedBy=multi-user.target"].join("\n")+"\n";
  await execute(conn,"sudo -S -p '' -- tee /etc/systemd/system/"+service,password+"\n"+unit,45000);
  await sudo(conn,"systemctl daemon-reload",password);
  await sudo(conn,"systemctl enable --now "+service,password);
  progress("Verifying managed services");
  await sudo(conn,"systemctl is-active "+service,password);
  return {name,os:"linux",arch,labels,host:parseHost(address,username).host,githubRunner:"registered",companion:"installed"};
 }finally{conn?.end();}
}
