import {createHash} from 'node:crypto';
import {createWriteStream,existsSync,mkdirSync,readFileSync,renameSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {promises as fs} from 'node:fs';
import {join,basename,dirname,resolve,relative} from 'node:path';
import {homedir,platform,arch} from 'node:os';
import {spawn} from 'node:child_process';

export const ARDUINO_CLI_RELEASE={
  family:'arduino-cli',name:'Arduino CLI',version:'1.5.1',category:'Embedded SDK',
  source:'https://github.com/arduino/arduino-cli/releases/tag/v1.5.1',
  targets:{
    'linux/arm64':{url:'https://github.com/arduino/arduino-cli/releases/download/v1.5.1/arduino-cli_1.5.1_Linux_ARM64.tar.gz',sha256:'1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62'},
    'linux/x64':{url:'https://github.com/arduino/arduino-cli/releases/download/v1.5.1/arduino-cli_1.5.1_Linux_64bit.tar.gz',sha256:'28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b'}
  }
};

export function targetKey(os,architecture){return os+'/'+architecture;}
export function recipeFor(os,architecture){return ARDUINO_CLI_RELEASE.targets[targetKey(os,architecture)]||null;}
export function sdkRoot(base=join(homedir(),'.local','share','maincreate','sdks')){
  if(!base||typeof base!=='string')throw new Error('Invalid per-user SDK root');
  return resolve(base);
}
export function validateArchiveEntry(name){
  const p=resolve('/stage',name);
  return !name.startsWith('/')&&!name.includes('\\')&&!name.split('/').includes('..')&&p.startsWith('/stage/');
}
async function download(url){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10*60*1000)});
  if(!response.ok)throw new Error('SDK download HTTP '+response.status);
  return Buffer.from(await response.arrayBuffer());
}
function tarList(archive){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn('tar',['-tzf','-'],{shell:false,stdio:['pipe','pipe','pipe']});let out='',error='';
    child.stdout.on('data',x=>out+=String(x));child.stderr.on('data',x=>error+=String(x));child.on('error',reject);
    child.on('close',code=>{if(code!==0)return reject(new Error('SDK archive listing failed: '+error.slice(-500)));const names=out.split(/\r?\n/).filter(Boolean);if(names.some(x=>!validateArchiveEntry(x)))return reject(new Error('SDK archive contains an unsafe path'));resolvePromise(names);});
    child.stdin.end(archive);
  });
}
async function untarGzip(archive,stage){
  const names=await tarList(archive);if(names.length>32)throw new Error('SDK archive contains too many entries');
  // The release archive is handled by the fixed system tar utility with no shell,
  // no user-controlled arguments, and a validated staging directory.
  return new Promise((resolvePromise,reject)=>{
    const child=spawn('tar',['-xzf','-','-C',stage],{shell:false,stdio:['pipe','ignore','pipe']});
    let error='';child.stderr.on('data',x=>error+=String(x));child.on('error',reject);
    child.on('close',code=>code===0?resolvePromise(names):reject(new Error('SDK archive extraction failed: '+error.slice(-500))));
    child.stdin.end(archive);
  });
}
async function verifyBinary(binary){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(binary,['version'],{shell:false,stdio:['ignore','pipe','pipe']});let out='';
    child.stdout.on('data',x=>out+=String(x));child.stderr.on('data',x=>out+=String(x));child.on('error',reject);
    child.on('close',code=>code===0&&out.includes('arduino-cli')?resolvePromise(out.trim().slice(0,500)):reject(new Error('Installed Arduino CLI failed version verification')));
  });
}
export async function installArduinoCli({os='linux',architecture=arch(),root=sdkRoot(),downloadFn=download}={}){
  if(os!=='linux'||!['arm64','x64'].includes(architecture))throw new Error('Arduino CLI supports Linux ARM64 and Linux x64 only');
  const recipe=recipeFor(os,architecture);if(!recipe)throw new Error('No validated Arduino CLI recipe for this platform');
  const archive=await downloadFn(recipe.url);const digest=createHash('sha256').update(archive).digest('hex');
  if(digest!==recipe.sha256)throw new Error('SDK checksum mismatch');
  mkdirSync(root,{recursive:true,mode:0o700});const parent=join(root,'arduino-cli','1.5.1',targetKey(os,architecture).replace('/','-'));
  mkdirSync(dirname(parent),{recursive:true,mode:0o700});const stage=await fs.mkdtemp(join(dirname(parent),'.stage-'));const backup=parent+'.previous';
  try{
    await untarGzip(archive,stage);const names=(await fs.readdir(stage,{withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.name);
    const binary=names.find(x=>x==='arduino-cli');if(!binary)throw new Error('SDK archive has no expected arduino-cli binary');
    const stagedBinary=join(stage,binary);const version=await verifyBinary(stagedBinary);
    if(existsSync(backup))rmSync(backup,{recursive:true,force:true});if(existsSync(parent))renameSync(parent,backup);
    renameSync(stage,parent);try{await verifyBinary(join(parent,'arduino-cli'));}catch(e){if(existsSync(parent))rmSync(parent,{recursive:true,force:true});if(existsSync(backup))renameSync(backup,parent);throw e;}
    if(existsSync(backup))rmSync(backup,{recursive:true,force:true});
    return {status:'installed',family:'arduino-cli',version:'1.5.1',target:targetKey(os,architecture),path:parent,sha256:digest,verification:version};
  }catch(e){if(existsSync(stage))rmSync(stage,{recursive:true,force:true});throw e;}
}
