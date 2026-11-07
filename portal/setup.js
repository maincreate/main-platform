"use strict";
let csrf=null;
const $=id=>document.getElementById(id);
const show=(message,isError=false)=>{const el=$("banner");el.textContent=message;el.className=isError?"error":"";};
async function request(path,options={}){
 const headers={...(options.body?{"content-type":"application/json"}:{}),...(csrf?{"x-tt-csrf":csrf}:{})};
 const res=await fetch(path,{...options,credentials:"same-origin",headers:{...headers,...(options.headers||{})},cache:"no-store"});
 let data={};try{data=await res.json();}catch{}
 if(!res.ok)throw new Error(data.error||("HTTP "+res.status));
 return data;
}
function tab(name){
 document.querySelectorAll("[data-view]").forEach(el=>el.hidden=el.dataset.view!==name);
 document.querySelectorAll("[data-tab]").forEach(el=>el.classList.toggle("active",el.dataset.tab===name));
 location.hash=name;
 show("");
}
async function populate(){
 const d=await request("/api/local/config");
 $("instanceName").value=d.config.name;
 $("instanceRole").value=d.config.role;
 $("tunnelHostname").value=d.config.tunnelHostname||"";
 $("appId").value=d.github.appId||"";
 $("installationId").value=d.github.installationId||"";
 $("repository").value=d.github.repository||"";
 $("privateKey").value="";
 $("githubState").textContent=d.github.verifiedAt?"Verified with GitHub at "+d.github.verifiedAt:(d.github.hasPrivateKey?"Private key stored (encrypted); not verified":"Not verified; GitHub App private key required");
 $("mcpState").textContent=d.mcpConfigured?"MCP token is configured on the controller. Check the separate gateway health endpoint before connecting.":"TT_MCP_TOKEN not configured on the controller.";
 const rows=$("runnerList");rows.replaceChildren();
 if(!d.runners.length)rows.textContent="No runners enrolled.";
 for(const r of d.runners){
   const item=document.createElement("div");item.className="runner";
   item.textContent=r.name+" · "+r.os+"/"+r.arch+" · "+(r.lastSeen?"last heartbeat "+r.lastSeen:"not yet online");
   rows.append(item);
 }
}
async function session(){
 try{
   const [s,info]=await Promise.all([request("/api/local/session"),request("/api/local/public")]);
   csrf=s.csrf;
   $("firstRun").hidden=!!s.authenticated||!!info.claimed;
   $("login").hidden=!!s.authenticated||!info.claimed;
   $("workspace").hidden=!s.authenticated;
   $("logout").hidden=!s.authenticated;
   if(s.authenticated){await populate();tab(["instance","github","tunnel","mcp","runners"].includes(location.hash.slice(1))?location.hash.slice(1):"instance");}
 }catch(e){show(e.message,true);}
}
document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>tab(btn.dataset.tab)));
$("firstRunForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const password=$("newPassword").value;
 if(password!==$("confirmPassword").value){show("Passwords do not match.",true);return;}
 try {
   const data=await request("/api/local/bootstrap",{method:"POST",body:JSON.stringify({
     username:$("newUsername").value.trim(),password
   })});
   csrf=data.csrf;
   $("newPassword").value="";$("confirmPassword").value="";
   await session();
   show("Administrator account created. You're signed in.");
 }catch(err){show(err.message,true);}
});
$("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();try{
   const data=await request("/api/local/login",{method:"POST",body:JSON.stringify({
     username:$("loginUsername").value.trim(),password:$("loginPassword").value
   })});
   csrf=data.csrf;$("loginPassword").value="";await session();show("Signed in.");
 }catch(err){show(err.message,true);}
});
$("logout").addEventListener("click",async()=>{
 try{await request("/api/local/logout",{method:"POST",body:"{}"});}catch{}
 csrf=null;await session();show("Signed out.");
});
$("passwordForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const next=$("changePassword").value;
 if(next!==$("changePasswordConfirm").value){show("New passwords do not match.",true);return;}
 try{
   await request("/api/local/account/password",{method:"POST",body:JSON.stringify({
     currentPassword:$("currentPassword").value,newPassword:next
   })});
   $("currentPassword").value="";$("changePassword").value="";$("changePasswordConfirm").value="";
   csrf=null;
   await session();
   show("Password updated. Please sign in again.");
 }catch(err){show(err.message,true);}
});
$("instanceForm").addEventListener("submit",async e=>{
 e.preventDefault();
 try{
   await request("/api/local/config",{method:"POST",body:JSON.stringify({name:$("instanceName").value,role:$("instanceRole").value,tunnelHostname:$("tunnelHostname").value.trim()})});
   await populate();show("Instance preferences saved. Deployment services do not change until Compose is updated.");
 }catch(err){show(err.message,true);}
});
$("githubForm").addEventListener("submit",async e=>{
 e.preventDefault();
 try{
   await request("/api/local/github",{method:"POST",body:JSON.stringify({appId:Number($("appId").value),installationId:Number($("installationId").value),repository:$("repository").value.trim(),privateKey:$("privateKey").value.trim()})});
   await populate();show("GitHub App credentials saved locally. Verify connection next.");
 }catch(err){show(err.message,true);}
});
$("verifyGithub").addEventListener("click",async()=>{
 try{const s=await request("/api/local/github/verify",{method:"POST",body:"{}"});await populate();show("GitHub App verified: "+s.app+" → "+s.repository);}
 catch(err){show(err.message,true);}
});
$("createInvite").addEventListener("click",async()=>{
 try{
   const base=$("runnerUrl").value.trim();const url=new URL(base);
   if(url.protocol!=="https:"&&!["localhost","127.0.0.1","portal","controller"].includes(url.hostname))throw new Error("Use a private HTTPS controller URL for remote runners");
   const os=$("runnerOS").value;
   const r=await request("/api/local/runners/invite",{method:"POST",body:"{}"});
   const cmd=os==="windows"?
     '$env:TT_CONTROLLER_URL="'+url.origin+'"\n$env:TT_ENROLLMENT_TOKEN="'+r.token+'"\nnode runner/agent.mjs enroll\nRemove-Item Env:TT_ENROLLMENT_TOKEN\nnode runner/agent.mjs run':
     'TT_CONTROLLER_URL="'+url.origin+'" TT_ENROLLMENT_TOKEN="'+r.token+'" node runner/agent.mjs enroll\nTT_CONTROLLER_URL="'+url.origin+'" node runner/agent.mjs run';
   $("inviteCommand").value="From a trusted TinkerTunnel repository checkout on the runner:\n\n"+cmd;
   $("inviteOutput").hidden=false;show("Single-use token issued; expires in 10 minutes.");
 }catch(err){show(err.message,true);}
});
$("copyInvite").addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText($("inviteCommand").value);show("Enrollment instructions copied.");}
 catch{show("Select and copy the instructions manually.",true);}
});
session();
