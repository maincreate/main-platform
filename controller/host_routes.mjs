import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {discoverHosts,hostFingerprint,pairOverSsh,validHost} from './hosts.mjs';
import {queueRunnerProvisioning,actionStatus} from './runner_provisioning.mjs';

export function hostDistributionRoute(req){
 const path=new URL(req.url).pathname,method=req.method;
 if(method!=='GET')return null;
 if(path==='/install.sh')return new Response(readFileSync(new URL('../scripts/install-linux.sh',import.meta.url)),{headers:{'content-type':'text/x-shellscript; charset=utf-8','cache-control':'no-store'}});
 if(path==='/downloads/tinkertunnel-host-linux-arm64')return new Response(readFileSync(new URL('../downloads/tinkertunnel-host-linux-arm64',import.meta.url)),{headers:{'content-type':'application/octet-stream','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'}});
 if(path==='/downloads/tinkertunnel-host-linux-arm64.sha256'){
  const data=readFileSync(new URL('../downloads/tinkertunnel-host-linux-arm64',import.meta.url));
  return new Response(createHash('sha256').update(data).digest('hex')+'  tinkertunnel-host-linux-arm64\n',{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
 }
 return null;
}
export async function adminHostRoute(req,ctx){
 const path=new URL(req.url).pathname,method=req.method;
 const {state,save,body,reply,deny,rnd,digest,session,seal,unseal,githubIdentityCurrent,limited}=ctx;
 if(path==='/api/local/builders/discover'&&method==='GET'){
  try{return reply({hosts:await discoverHosts()})}catch{return reply({hosts:[],warning:'mDNS not reachable from controller. Use hostname or IP.'})}
 }
 if(path==='/api/local/builders/fingerprint'&&method==='GET'){
  const host=new URL(req.url).searchParams.get('host')||'';
  if(!validHost(host))return deny(422,'Enter a valid hostname or IPv4 address');
  try{const found=await hostFingerprint(host);return reply({host,fingerprint:found.fingerprint})}
  catch{return deny(502,'SSH host key unavailable. Check hostname/IP and SSH reachability.')}
 }
 if(path==='/api/local/builders/pair'&&method==='POST'){
  const input=await body(req),host=input.host,username=input.username,password=input.password,fingerprint=input.fingerprint;
  if(!validHost(host)||typeof username!=='string'||typeof fingerprint!=='string'||input.confirmFingerprint!==true)
   return deny(422,'Confirm the SSH fingerprint and enter valid host details');
  if(limited('builder-pair:'+session(req).username,15))return deny(429,'Too many pairing attempts');
  const forwarded=(req.headers.get('x-forwarded-host')||req.headers.get('host')||'').split(',')[0].trim();
  const controller=process.env.TT_PUBLIC_URL||'https://'+forwarded;
  if(!/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/i.test(controller))
   return deny(422,'Configure TT_PUBLIC_URL with the HTTPS controller origin');
  const before=state();
  if(before.runners.some(r=>r.managedHost?.host===host))
   return deny(409,'This address is already paired. If you re-imaged the host, reconcile its previous enrollment first.');
  const invitation=rnd();
  before.invites=(before.invites||[]).filter(x=>x.expires>Date.now());
  before.invites.push({hash:digest(invitation),expires:Date.now()+10*60*1000});
  save(before);
  let paired;
  try{paired=await pairOverSsh({host,username,password,fingerprint,controller,invitation})}
  catch(e){return deny(502,'Pairing failed: '+String(e.message||'SSH unavailable').slice(0,200))}
  const stored=state(),runner=stored.runners.find(r=>r.id===paired.runnerId);
  if(!runner)return deny(502,'Host enrolled without a controller record');
  runner.managedHost={host,sshFingerprint:paired.fingerprint,pairedAt:new Date().toISOString()};
  save(stored);
  // Enrollment is complete here, independently of GitHub. Auto-provision only after pairing.
  // GitHub failure must not roll back or conceal a valid, authenticated host enrollment.
  let provisioning=null,provisioningError=null;
  try{
   provisioning=await queueRunnerProvisioning(runner.id,{state,save,seal,unseal,githubIdentityCurrent,rnd},
    {permitPendingHeartbeat:true});
  }catch(e){provisioningError=String(e.message||'Runner registration unavailable').slice(0,300)}
  const current=state(),savedRunner=current.runners.find(r=>r.id===paired.runnerId);
  return reply({runner:{id:runner.id,name:runner.name,os:runner.os,arch:runner.arch,
    managedHost:savedRunner?.managedHost,githubRunnerName:savedRunner?.githubRunnerName||null},
    provisioning,provisioningError,
    message:provisioning?'Host Service paired; GitHub runner installation and registration queued for '+runner.name+'. Builder not ready until GitHub confirms Online.':
      'Host Service paired; GitHub runner setup incomplete. Inspect the Builders error before retrying.'});
 }
 if(path==='/api/local/builders/actions'&&method==='GET')return reply({actions:(state().hostActions||[]).slice(-30).map(({id,runnerId,runnerName,status,createdAt,completedAt,message})=>({id,runnerId,runnerName,status,createdAt,completedAt,message}))});
 if(path==='/api/local/builders/provision'&&method==='POST'){
  const input=await body(req);
  try{
   const action=await queueRunnerProvisioning(input.runnerId,{state,save,seal,unseal,githubIdentityCurrent,rnd});
   return reply({action});
  }catch(e){return deny(e.status||502,e.message||'Unable to provision GitHub Actions runner')}
 }
 return null;
}
export async function agentHostRoute(req,ctx){
 const path=new URL(req.url).pathname,method=req.method;
 if(method!=='POST'||!['/api/agent/actions/claim','/api/agent/actions/complete'].includes(path))return null;
 const {state,save,body,reply,deny,digest,equal,unseal}=ctx;
 const input=await body(req),s=state(),token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
 const runner=s.runners.find(r=>r.id===input.id&&equal(r.tokenHash,digest(token)));
 if(!runner)return deny(401,'Invalid host credential');
 s.hostActions=s.hostActions||[];
 if(path.endsWith('/claim')){
  runner.lastSeen=new Date().toISOString();
  const action=s.hostActions.find(a=>a.runnerId===runner.id&&a.status==='queued');
  if(!action){save(s);return reply({action:null})}
  if(Date.now()>=Date.parse(action.expiresAt)){action.status='expired';delete action.secret;save(s);return reply({action:null})}
  const secret=unseal(action.secret);
  action.status='claimed';action.claimedAt=new Date().toISOString();save(s);
  return reply({action:{id:action.id,type:'github-runner.provision',organization:action.organization,runner_name:action.runnerName,labels:action.labels,registration_token:secret,expires_at:action.expiresAt}});
 }
 const action=s.hostActions.find(a=>a.id===input.action_id&&a.runnerId===runner.id&&a.status==='claimed');
 if(!action)return deny(409,'Unknown or previously completed host action');
 if(typeof input.success!=='boolean')return deny(422,'Action success required');
 action.status=input.success?'completed':'failed';action.completedAt=new Date().toISOString();
 action.message=String(input.message||'').slice(0,1000);delete action.secret;
 if(input.success){runner.githubRunnerName=action.runnerName;runner.labels=action.labels}
 save(s);return reply({ok:true,status:action.status});
}
