import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

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
 if(path==='/api/local/builders/actions'&&method==='GET')return reply({actions:(state().hostActions||[]).slice(-30).map(({id,runnerId,runnerName,status,createdAt,completedAt,message})=>({id,runnerId,runnerName,status,createdAt,completedAt,message}))});
 if(path==='/api/local/builders/provision'&&method==='POST'){
  const input=await body(req),s=state(),runner=s.runners.find(r=>r.id===input.runnerId);
  if(!runner?.managedHost||runner.os!=='linux'||runner.arch!=='arm64')return deny(422,'Select a paired Linux ARM64 host');
  if(!runner.lastSeen||Date.now()-Date.parse(runner.lastSeen)>120000)return deny(409,'Host must be online before provisioning');
  if(runner.githubRunnerName)return deny(409,'Runner already managed on this host');
  if((s.hostActions||[]).some(a=>a.runnerId===runner.id&&['queued','claimed'].includes(a.status)))return deny(409,'Provisioning already pending');
  const gh=s.github||{},org=gh.selectedOrganization;
  if(!githubIdentityCurrent(gh)||!org)return deny(409,'Connect and select a GitHub organization');
  const runnerName='tt-'+String(runner.name).toLowerCase().replace(/[^a-z0-9_.-]/g,'-').slice(0,46)+'-'+runner.id.slice(0,8);
  const labels=['tt-linux','tt-arm64','tt-managed'];
  if((runner.packages||[]).some(p=>p.name==='esp-idf'))labels.push('tt-esp-idf');
  let response;
  try{response=await fetch('https://api.github.com/orgs/'+encodeURIComponent(org)+'/actions/runners/registration-token',{
   method:'POST',headers:{authorization:'Bearer '+unseal(gh.oauthToken),accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'TinkerTunnel'},signal:AbortSignal.timeout(15000)});
  }catch{return deny(502,'GitHub runner registration API unavailable')}
  if(!response.ok)return deny(response.status===403?403:502,'GitHub could not issue runner token. Grant organization Self-hosted runners: write permission to TinkerTunnel GitHub App.');
  const issued=await response.json();
  if(typeof issued.token!=='string'||issued.token.length<15||!Number.isFinite(Date.parse(issued.expires_at)))return deny(502,'Invalid GitHub registration-token response');
  const action={id:rnd(),runnerId:runner.id,runnerName,organization:org,labels,secret:seal(issued.token),expiresAt:issued.expires_at,status:'queued',createdAt:new Date().toISOString()};
  s.hostActions=[...(s.hostActions||[]).slice(-99),action];save(s);
  return reply({action:{id:action.id,runnerName,status:action.status,organization:org,labels}});
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
