/** Controller-owned GitHub Actions registration lifecycle for a paired Host Service.
 * No permanent GitHub or Cloudflare provider credentials are sent to the builder.
 */
const safeRunnerName=name=>typeof name==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(name);
export const actionStatus=(runner,actions=[])=>{
 if(runner.githubRunnerName)return "configured";
 const current=[...actions].reverse().find(a=>a.runnerId===runner.id);
 return current?.status||"not_requested";
};
export function runnerIdentity(runner){
 // Use the exact Raspberry Pi Imager hostname; never invent a second runner name.
 if(!safeRunnerName(runner?.name))throw Object.assign(new Error("The host must have a GitHub-compatible hostname (1–60 letters, numbers, dots, hyphens or underscores)."),{status:422});
 if(runner.os!=="linux"||runner.arch!=="arm64"||!runner.managedHost)
  throw Object.assign(new Error("Choose a paired Linux ARM64 Host Service."),{status:422});
 return runner.name;
}
export function runnerLabels(runner){
 const labels=["tt-managed","tt-linux","tt-arm64"];
 if((runner.packages||[]).some(p=>p.name==="esp-idf"&&typeof p.version==="string"&&p.version.length))labels.push("tt-esp-idf");
 return labels;
}
export async function queueRunnerProvisioning(runnerId,ctx,{permitPendingHeartbeat=false}={}){
 const {state,save,seal,unseal,githubIdentityCurrent}=ctx;
 const current=state(),runner=current.runners.find(r=>r.id===runnerId);
 if(!runner)throw Object.assign(new Error("Host not enrolled."),{status:404});
 const runnerName=runnerIdentity(runner);
 if(runner.githubRunnerName)throw Object.assign(new Error("This host already has a managed GitHub runner."),{status:409});
 const latest=(current.hostActions||[]).filter(a=>a.runnerId===runner.id).at(-1);
 if(latest&&["queued","claimed"].includes(latest.status)){
  // Do not register twice, including when the host hasn't checked in yet.
  return {id:latest.id,runnerName:latest.runnerName,status:latest.status,organization:latest.organization,labels:latest.labels,existing:true};
 }
 if(!permitPendingHeartbeat&&(!runner.lastSeen||Date.now()-Date.parse(runner.lastSeen)>120000))
  throw Object.assign(new Error("Wait until the paired Host Service is online before retrying GitHub registration."),{status:409});
 const gh=current.github||{},org=gh.selectedOrganization;
 if(!githubIdentityCurrent(gh)||!org||!gh.oauthOrganizations?.some(x=>x.login===org))
  throw Object.assign(new Error("Connect GitHub and select an organization in Settings first."),{status:409});
 // A GitHub App user token must be authorized for organization self-hosted runners: write.
 // That permission is separate from repository metadata/read access.
 let response;
 try{
  response=await fetch("https://api.github.com/orgs/"+encodeURIComponent(org)+"/actions/runners/registration-token",{
   method:"POST",headers:{authorization:"Bearer "+unseal(gh.oauthToken),
    accept:"application/vnd.github+json","x-github-api-version":"2022-11-28","user-agent":"Main{Create}"},
   signal:AbortSignal.timeout(15000)});
 }catch{
  throw Object.assign(new Error("GitHub runner registration API unreachable."),{status:502});
 }
 if(!response.ok){
  const explanation=response.status===403?
    "GitHub denied runner registration. Check organization administration access and the Main{Create} GitHub App's Self-hosted runners: write permission.":
    response.status===401?"GitHub authorization expired. Reconnect GitHub in Settings.":
    "GitHub runner registration API returned HTTP "+response.status+".";
  throw Object.assign(new Error(explanation),{status:response.status===401?409:response.status===403?403:502});
 }
 const issued=await response.json().catch(()=>null);
 if(typeof issued?.token!=="string"||issued.token.length<15||
    !Number.isFinite(Date.parse(issued.expires_at))||Date.parse(issued.expires_at)<=Date.now()+60000)
  throw Object.assign(new Error("GitHub issued an invalid or nearly expired registration token."),{status:502});
 // Re-read the durable state after awaiting GitHub so concurrent host heartbeats aren't lost.
 const next=state(),paired=next.runners.find(r=>r.id===runnerId);
 if(!paired||!paired.managedHost||paired.githubRunnerName||next.github?.selectedOrganization!==org)
  throw Object.assign(new Error("The paired host or selected GitHub organization changed during provisioning."),{status:409});
 if((next.hostActions||[]).some(a=>a.runnerId===runnerId&&["queued","claimed"].includes(a.status)))
  throw Object.assign(new Error("Runner provisioning was already started for this host."),{status:409});
 if(next.runners.some(r=>r.id!==runnerId&&r.githubRunnerName?.toLowerCase()===runnerName.toLowerCase()))
  throw Object.assign(new Error("A Main{Create}-managed runner with that hostname already exists."),{status:409});
 const action={id:ctx.rnd(),runnerId,runnerName,organization:org,labels:runnerLabels(paired),
  secret:seal(issued.token),expiresAt:issued.expires_at,status:"queued",createdAt:new Date().toISOString()};
 next.hostActions=[...(next.hostActions||[]).slice(-99),action];
 save(next);
 return {id:action.id,runnerName,status:action.status,organization:org,labels:action.labels};
}
