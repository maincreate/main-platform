import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {discoverHosts,hostFingerprint,pairOverSsh,validHost} from './hosts.mjs';
import {queueRunnerProvisioning,actionStatus} from './runner_provisioning.mjs';

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
 if(path==='/api/local/builders/remove'&&method==='POST'){
  const input=await body(req),id=input.runnerId,confirmedName=input.confirmName;
  if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))return deny(422,'Select a valid builder');
  const start=state(),host=start.runners.find(r=>r.id===id);
  if(!host)return deny(404,'Builder was already removed. Refresh the list.');
  if(confirmedName!==host.name)return deny(422,'Type the exact builder hostname to confirm removal');
  if(limited('builder-remove:'+session(req).username,10))return deny(429,'Too many removal attempts');
  const actions=(start.hostActions||[]).filter(a=>a.runnerId===id);
  if(actions.some(a=>['queued','claimed'].includes(a.status)))return deny(409,'Runner setup is in progress. Wait for it to finish before removing this builder.');
  // A failed completion report can still leave a registered runner in GitHub.
  // Inspect the hostname from an actual provisioning action before forgetting it.
  const issued=actions.filter(a=>a.runnerName===host.name&&a.organization).at(-1);
  const runnerName=host.githubRunnerName||issued?.runnerName||null;
  let githubResult='not_registered';
  if(runnerName){
   const gh=start.github||{},org=gh.selectedOrganization;
   const latest=actions.filter(a=>a.organization).at(-1);
   if(!githubIdentityCurrent(gh)||!org||latest?.organization!==org)
    return deny(409,'Reconnect the original GitHub organization before removing its registered runner.');
   const headers={authorization:'Bearer '+unseal(gh.oauthToken),
    accept:'application/vnd.github+json','user-agent':'TinkerTunnel','x-github-api-version':'2022-11-28'};
   const url='https://api.github.com/orgs/'+encodeURIComponent(org)+'/actions/runners';
   let response;
   try{response=await fetch(url+'?per_page=100',{headers,signal:AbortSignal.timeout(15000)})}
   catch{return deny(502,'Could not check GitHub runner status. No builder was removed.')}
   if(!response.ok)return deny(response.status===403?403:502,'Unable to verify GitHub organization runners; no builder was removed.');
   const listing=await response.json();
   if(!Array.isArray(listing.runners))return deny(502,'GitHub runner inventory was incomplete; no builder was removed.');
   const found=listing.runners.filter(r=>r.name===runnerName);
   if(found.length!==1){
    // A single page may be incomplete. Do not silently ignore a runner that
    // could still be registered in an organization with >100 runners.
    if(found.length>1||Number(listing.total_count)>listing.runners.length)
     return deny(409,'Runner could not be uniquely verified in GitHub. Review the organization runner inventory before removing.');
    githubResult='not_found';
   }else{
    if(found[0].busy||found[0].status!=='offline')
     return deny(409,'GitHub runner is online or busy. Drain and stop its service on the host before removing it.');
    const current=state(),same=current.runners.find(r=>r.id===id);
    if(!same||same.githubRunnerName!==runnerName)return deny(409,'Builder changed during removal. Refresh and retry.');
    let deleted;
    try{deleted=await fetch(url+'/'+found[0].id,{method:'DELETE',headers,signal:AbortSignal.timeout(15000)})}
    catch{return deny(502,'GitHub runner removal could not be confirmed. No local record removed. Check GitHub before retrying.')}
    if(deleted.status!==204&&deleted.status!==404)
     return deny(deleted.status===403?403:502,'GitHub runner removal failed (HTTP '+deleted.status+'). Builder retained.');
    githubResult=deleted.status===204?'removed':'already_removed';
   }
  }
  const next=state(),entry=next.runners.find(r=>r.id===id);
  if(!entry||(entry.githubRunnerName||actions.filter(a=>a.runnerName===host.name&&a.organization).at(-1)?.runnerName||null)!==runnerName)
   return deny(409,'Builder changed during removal. Refresh before retrying.');
  if((next.hostActions||[]).some(a=>a.runnerId===id&&['queued','claimed'].includes(a.status)))
   return deny(409,'An installation action started during removal. Refresh and retry.');
  next.runners=next.runners.filter(r=>r.id!==id);
  // Revoke the individual enrollment token by dropping the sole stored digest.
  // Retain non-secret history for diagnosis, never keep an issued GitHub token.
  next.hostActions=(next.hostActions||[]).map(a=>a.runnerId===id?
   {...a,secret:undefined,removedHostAt:new Date().toISOString()}:a);
  next.builderRemovalAudit=[...(next.builderRemovalAudit||[]).slice(-49),{
   id,name:host.name,githubRunnerName:runnerName,githubResult,
   removedAt:new Date().toISOString(),actor:session(req).username
  }];
  save(next);
  return reply({removed:true,name:host.name,githubResult,
   localCleanupRequired:true,
   message:'Builder removed from TinkerTunnel and its host token revoked. Clean up the old local enrollment and runner installation before pairing again.'});
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
