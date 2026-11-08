import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {discoverHosts,hostFingerprint,pairOverSsh,validHost} from './hosts.mjs';
import {queueRunnerProvisioning,actionStatus} from './runner_provisioning.mjs';

const builderFresh = r => !!(r.lastSeen&&Date.now()-Date.parse(r.lastSeen)<120000);
const runnerForRemoval = (host, actions) => host.githubRunnerName||
  actions.filter(a=>a.runnerId===host.id&&a.runnerName===host.name&&a.organization).at(-1)?.runnerName||null;
async function unregisterGithubRunner(host,actions,ctx){
 const name=runnerForRemoval(host,actions);
 if(!name)return 'not_registered';
 const {state,unseal,githubIdentityCurrent}=ctx;
 const gh=state().github||{},org=gh.selectedOrganization;
 const actualOrg=actions.filter(a=>a.runnerId===host.id&&a.organization).at(-1)?.organization||null;
 if(!githubIdentityCurrent(gh)||!org||org!==actualOrg)throw Error('Reconnect the original GitHub organization to remove its runner.');
 const headers={authorization:'Bearer '+unseal(gh.oauthToken),accept:'application/vnd.github+json',
   'user-agent':'TinkerTunnel','x-github-api-version':'2022-11-28'};
 const base='https://api.github.com/orgs/'+encodeURIComponent(org)+'/actions/runners';
 for(let attempt=0;attempt<4;attempt++){
  const response=await fetch(base+'?per_page=100',{headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('GitHub runner inventory unavailable (HTTP '+response.status+').');
  const data=await response.json();
  if(!Array.isArray(data.runners)||Number(data.total_count)>data.runners.length)
   throw Error('GitHub runner inventory is incomplete; manual review required.');
  const matches=data.runners.filter(r=>r.name===name);
  if(matches.length>1)throw Error('Ambiguous GitHub runner identity; manual review required.');
  if(!matches.length)return 'not_found';
  const found=matches[0];
  if(found.busy)throw Error('GitHub runner has an active job. Wait for it to finish.');
  if(found.status!=='offline'&&host.decommission?.mode!=='remote'){
   if(attempt===3)throw Error('GitHub runner is still online. Wait for shutdown or select unreachable removal once the host is offline.');
   await new Promise(resolve=>setTimeout(resolve,2000));continue;
  }
  const deleted=await fetch(base+'/'+found.id,{method:'DELETE',headers,signal:AbortSignal.timeout(15000)});
  if(deleted.status===204)return 'removed';
  if(deleted.status===404)return 'already_removed';
  throw Error('GitHub runner deletion failed (HTTP '+deleted.status+').');
 }
 throw Error('GitHub runner did not stop.');
}
function finishBuilderRemoval(id,ctx,localResult){
 const {state,save,session}=ctx;const s=state(),host=s.runners.find(r=>r.id===id);
 if(!host)return null;
 const lifecycle=host.decommission||{};
 s.runners=s.runners.filter(r=>r.id!==id);
 s.hostActions=(s.hostActions||[]).map(a=>a.runnerId===id?{...a,secret:undefined}:a);
 s.builderRemovalAudit=[...(s.builderRemovalAudit||[]).slice(-49),{
  id,name:host.name,githubRunnerName:runnerForRemoval(host,s.hostActions||[]),
  githubResult:lifecycle.githubResult||'not_registered',localResult,
  removedAt:new Date().toISOString(),actor:lifecycle.actor||'controller'
 }];
 save(s);
 return {removed:true,name:host.name,githubResult:lifecycle.githubResult||'not_registered',
  localResult,localCleanupRequired:localResult!=='cleanup_scheduled'};
}
function queueDecommissionAction(id,type,ctx){
 const s=ctx.state(),host=s.runners.find(r=>r.id===id);
 if(!host?.decommission)throw Error('Decommissioning record missing.');
 if((s.hostActions||[]).some(a=>a.runnerId===id&&['queued','claimed'].includes(a.status)))
  throw Error('Another host action is still active.');
 const action={id:ctx.rnd(),runnerId:id,type,runnerName:host.name,
  expiresAt:new Date(Date.now()+5*60*1000).toISOString(),status:'queued',
  createdAt:new Date().toISOString()};
 s.hostActions=[...(s.hostActions||[]).slice(-99),action];
 host.decommission.phase=type==='github-runner.stop'?'stopping':'cleaning';
 ctx.save(s);return action;
}
async function progressBuilderDecommission(id,ctx){
 const saved=ctx.state(),host=saved.runners.find(r=>r.id===id);
 if(!host?.decommission)return null;
 try{
  const githubResult=host.decommission.githubResult||await unregisterGithubRunner(host,saved.hostActions||[],ctx);
  const s=ctx.state(),current=s.runners.find(r=>r.id===id);
  if(!current?.decommission)return null;
  current.decommission.githubResult=githubResult;current.decommission.phase='unregistered';
  ctx.save(s);
  if(current.decommission.mode==='remote')return finishBuilderRemoval(id,ctx,'not_reachable');
  queueDecommissionAction(id,'host.cleanup',ctx);
  return {queued:true,phase:'cleaning'};
 }catch(error){
  const s=ctx.state(),current=s.runners.find(r=>r.id===id);
  if(current?.decommission){current.decommission.phase='failed';current.decommission.error=String(error.message||error).slice(0,300);ctx.save(s);}
  return {error:String(error.message||error)};
 }
}


export function hostDistributionRoute(req){
 const path=new URL(req.url).pathname,method=req.method;
 if(method!=='GET')return null;
 if(path==='/install.sh')return new Response(readFileSync(new URL('../scripts/install-linux.sh',import.meta.url)),{headers:{'content-type':'text/x-shellscript; charset=utf-8','cache-control':'no-store'}});
 if(path==='/uninstall.sh')return new Response(readFileSync(new URL('../scripts/uninstall-linux.sh',import.meta.url)),{headers:{'content-type':'text/x-shellscript; charset=utf-8','cache-control':'no-store'}});
 if(path==='/downloads/tinkertunnel-host-linux-arm64')return new Response(readFileSync(new URL('../downloads/tinkertunnel-host-linux-arm64',import.meta.url)),{headers:{'content-type':'application/octet-stream','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'}});
 if(path==='/downloads/tinkertunnel-host-linux-arm64.sha256'){
  const data=readFileSync(new URL('../downloads/tinkertunnel-host-linux-arm64',import.meta.url));
  return new Response(createHash('sha256').update(data).digest('hex')+'  tinkertunnel-host-linux-arm64\n',{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
 }
 return null;
}
export async function adminHostRoute(req,ctx){
 const path=new URL(req.url).pathname,method=req.method;
 const {state,save,body,reply,deny,rnd,digest,session,seal,unseal,githubIdentityCurrent,limited,verifyPassword}=ctx;
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
 if(path==='/api/local/builders/remove'&&method==='POST'){
  const input=await body(req),id=input.runnerId;
  if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))return deny(422,'Select a valid builder');
  const initial=state(),host=initial.runners.find(r=>r.id===id);
  if(!host)return deny(404,'Builder already removed. Refresh the list.');
  if(input.confirmName!==host.name)return deny(422,'Type the exact hostname to confirm.');
  if(limited('builder-remove:'+session(req).username,5))return deny(429,'Too many removal attempts.');
  if(typeof input.password!=='string'||input.password.length>256||
     !(await verifyPassword(input.password,initial.admin?.password)))
    return deny(401,'Administrator password confirmation failed.');
  const mode=input.mode;
  if(!['managed','remote'].includes(mode))return deny(422,'Select full cleanup or unreachable removal.');
  if(mode==='remote'&&builderFresh(host))
   return deny(409,'Host is still connected. Use managed removal or wait for it to become unreachable.');
  if((initial.hostActions||[]).some(a=>a.runnerId===id&&['queued','claimed'].includes(a.status)))
   return deny(409,'A host operation is in progress. Wait for it to finish.');
  if(mode==='managed'&&!builderFresh(host))return deny(409,'Host is unreachable. Choose unreachable removal.');
  const s=state(),entry=s.runners.find(r=>r.id===id);
  if(!entry)return deny(409,'Builder changed. Refresh.');
  entry.decommission={mode,phase:'requested',actor:session(req).username,startedAt:new Date().toISOString(),error:null,
   githubResult:entry.decommission?.githubResult||null};
  save(s);
  if(mode==='remote'){
   const outcome=await progressBuilderDecommission(id,{state,save,rnd,unseal,githubIdentityCurrent});
   if(outcome?.error)return deny(502,outcome.error+' Builder kept for retry.');
   return reply(outcome);
  }
  try{
   const action=queueDecommissionAction(id,runnerForRemoval(entry,s.hostActions||[])?
     'github-runner.stop':'host.cleanup',{state,save,rnd});
   return reply({queued:true,phase:action.type==='github-runner.stop'?'stopping':'cleaning',name:entry.name});
  }catch(e){return deny(409,String(e.message||e))}
 }
 if(path==='/api/local/builders/remove/status'&&method==='GET'){
  const id=new URL(req.url).searchParams.get('id');
  const current=state(),host=current.runners.find(r=>r.id===id);
  if(host)return reply({removed:false,phase:host.decommission?.phase||null,error:host.decommission?.error||null,
   mode:host.decommission?.mode||null});
  const audit=(current.builderRemovalAudit||[]).findLast(r=>r.id===id);
  return audit?reply({...audit,removed:true}):deny(404,'Builder not found');
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
  const secret=action.secret?unseal(action.secret):null;
  action.status='claimed';action.claimedAt=new Date().toISOString();save(s);
  return reply({action:{id:action.id,type:action.type||'github-runner.provision',organization:action.organization,runner_name:action.runnerName,labels:action.labels,registration_token:secret,expires_at:action.expiresAt}});
 }
 const action=s.hostActions.find(a=>a.id===input.action_id&&a.runnerId===runner.id&&a.status==='claimed');
 if(!action)return deny(409,'Unknown or previously completed host action');
 if(typeof input.success!=='boolean')return deny(422,'Action success required');
 action.status=input.success?'completed':'failed';action.completedAt=new Date().toISOString();
 action.message=String(input.message||'').slice(0,1000);delete action.secret;
 if(input.success&&(!action.type||action.type==='github-runner.provision')){
  runner.githubRunnerName=action.runnerName;runner.labels=action.labels;
 }
 if(action.type&&runner.decommission){
  if(!input.success){runner.decommission.phase='failed';runner.decommission.error=action.message;}
  else runner.decommission.phase=action.type==='github-runner.stop'?'unregistering':'cleanup_scheduled';
 }
 save(s);
 if(input.success&&action.type==='github-runner.stop'){
  const result=await progressBuilderDecommission(runner.id,{state,save,rnd:ctx.rnd,unseal,githubIdentityCurrent:ctx.githubIdentityCurrent});
  return reply({ok:true,status:action.status,progress:result});
 }
 if(input.success&&action.type==='host.cleanup'){
  const result=finishBuilderRemoval(runner.id,{state,save},'cleanup_scheduled');
  return reply({ok:true,status:action.status,progress:result});
 }
 return reply({ok:true,status:action.status});
}
