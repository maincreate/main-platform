"use strict";
const $=id=>document.getElementById(id);
let csrf=null;
const appearance = maincreateAppearance;
const appearanceMode = $("appearanceMode");
const lightTemplate = $("lightTemplate");
const darkTemplate = $("darkTemplate");
const customTemplate = $("customTemplate");
const appearanceStatus = $("appearanceStatus");

function renderAppearance(editorId = customTemplate.value) {
 const {mode, light, dark, templates} = appearance.read();
 const options = [...Object.entries(appearance.presets), ...templates.map(({id, name}) => [id, name])];
 appearanceMode.value = mode;
 lightTemplate.replaceChildren(...options.map(([id, name]) => new Option(name, id)));
 darkTemplate.replaceChildren(...options.map(([id, name]) => new Option(name, id)));
 lightTemplate.value = light;
 darkTemplate.value = dark;
 customTemplate.replaceChildren(new Option("New template", ""), ...templates.map(({id, name}) => new Option(name, id)));
 customTemplate.value = templates.some(template => template.id === editorId) ? editorId : "";
}

function editTemplate() {
 const selected = appearance.read().templates.find(template => template.id === customTemplate.value);
 $("templateName").value = selected?.name ?? "";
 for (const color of appearance.colors) {
  const input = $("theme-" + color);
  input.value = selected?.[color] ?? input.defaultValue;
 }
 $("deleteTemplate").hidden = !selected;
}

function saveAppearance(next, message, editorId) {
 try {
  appearance.save(next);
 } catch {
  renderAppearance();
  appearanceStatus.textContent = "This browser could not save the appearance settings.";
  return false;
 }
 renderAppearance(editorId);
 appearanceStatus.textContent = message;
 return true;
}

for (const [input, field] of [[appearanceMode, "mode"], [lightTemplate, "light"], [darkTemplate, "dark"]]) {
 input.addEventListener("change", () => saveAppearance({...appearance.read(), [field]: input.value}, "Appearance saved."));
}
customTemplate.addEventListener("change", editTemplate);
$("appearanceForm").addEventListener("submit", event => {
 event.preventDefault();
 const name = $("templateName").value.trim();
 if (!name) {
  appearanceStatus.textContent = "Enter a template name.";
  $("templateName").focus();
  return;
 }
 const palette = Object.fromEntries(appearance.colors.map(color => [color, $("theme-" + color).value]));
 if (["text", "accent"].some(color => ["bg", "surface"].some(surface => appearance.contrast(palette[color], palette[surface]) < 4.5))) {
  appearanceStatus.textContent = "Use text and accent colors with at least 4.5:1 contrast against the canvas and surface.";
  return;
 }
 const id = customTemplate.value || "custom-" + crypto.randomUUID();
 const current = appearance.read();
 const template = {id, name, ...palette};
 const templates = customTemplate.value
  ? current.templates.map(item => item.id === id ? template : item)
  : [...current.templates, template];
 if (saveAppearance({...current, templates}, "Template saved. Assign it to light or dark mode above.", id)) editTemplate();
});
$("deleteTemplate").addEventListener("click", () => {
 const id = customTemplate.value;
 const current = appearance.read();
 const next = {
  ...current,
  light: current.light === id ? appearance.defaults.light : current.light,
  dark: current.dark === id ? appearance.defaults.dark : current.dark,
  templates: current.templates.filter(template => template.id !== id),
 };
 if (saveAppearance(next, "Template deleted. Any slot using it returned to its default.", "")) editTemplate();
});
window.addEventListener("storage", () => { renderAppearance(); editTemplate(); });
renderAppearance();
editTemplate();
async function api(path,payload){
 const opts={credentials:"same-origin",cache:"no-store"};
 if(payload!==undefined){
  opts.method="POST";
  opts.headers={"content-type":"application/json","x-maincreate-csrf":csrf};
  opts.body=JSON.stringify(payload);
 }
 const response=await fetch(path,opts);
 if(response.status===401){location.replace("/setup");throw Error("Sign in required");}
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"Unable to complete request");
 return result;
}
async function load(){
 try{
  const d=await api("/api/local/overview");
  csrf=d.csrf;$("username").textContent=d.username||"administrator";
  $("githubState").textContent=d.github?.identityConnected&&d.github?.organization?
   "Connected to "+d.github.organization+" as @"+(d.github.login||"GitHub user"):
   d.github?.authorizationExpired?"Authorization expired — reconnect required":
   d.github?.identityConnected?"Account linked, no organization selected":"Not connected";
  await loadRepositoryPreferences();
  await loadApprovalPreferences();
  await loadAiConnection(true);
  $("executionStatus").textContent=(d.jobs?.pending||0)+
   " job(s) awaiting review. Each job requires explicit approval; track progress in Builders & Jobs.";
 }catch(e){$("notice").textContent=e.message;}
}
$("passwordForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const password=$("nextPassword").value;
 if(password!==$("confirmNextPassword").value){$("notice").textContent="New passwords do not match.";return;}
 try{
  await api("/api/local/account/password",{currentPassword:$("currentPassword").value,newPassword:password});
  location.replace("/setup");
 }catch(e){$("notice").textContent=e.message;}
});
load();

async function loadRepositoryPreferences(){
 const preferences=await api("/api/local/github/repository/preferences");
 $("defaultVisibility").value=preferences.defaultVisibility||"private";
 const list=$("repoRequests");list.replaceChildren();
 if(!preferences.requests?.length){const p=document.createElement("p");p.textContent="No repository requests.";list.append(p);return;}
 for(const request of preferences.requests){
  const row=document.createElement("div");row.className="maincreate-approval-row";
  const detail=document.createElement("div"),label=document.createElement("strong"),meta=document.createElement("small");
  label.textContent=request.organization+"/"+request.name+" · "+request.visibility;
  meta.textContent=request.status+" · "+request.source+" · "+new Date(request.requestedAt).toLocaleString();
  detail.append(label,meta);row.append(detail);
  if(request.status==="pending"){
    const actions=document.createElement("div");actions.className="maincreate-approval-actions";
    for(const [decision,title] of [["approve","Approve"],["reject","Reject"]]){
      const button=document.createElement("button");button.type="button";button.className="plain-button";button.textContent=title;
      button.addEventListener("click",async()=>{
        const summary=request.organization+"/"+request.name+" ("+request.visibility+")";
        if(!confirm((decision==="approve"?"Create ":"Reject ")+summary+"?"))return;
        button.disabled=true;
        try{
          await api("/api/local/github/repository/requests/decision",{
           requestId:request.id,decision,organization:request.organization,
           name:request.name,visibility:request.visibility});
          $("visibilityNotice").textContent="Request "+decision+"d: "+summary;
          await loadRepositoryPreferences();
        }catch(e){$("visibilityNotice").textContent=e.message;button.disabled=false;}
      });
      actions.append(button);
    }
    row.append(actions);
  }
  if(request.status==="created"&&request.result?.url){
    const a=document.createElement("a");a.href=request.result.url;a.target="_blank";a.rel="noopener noreferrer";
    a.className="quiet-link";a.textContent="Open repository";row.append(a);
  }
  list.append(row);
 }
}
$("visibilityForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const button=event.currentTarget.querySelector("button");button.disabled=true;
 try{
  const result=await api("/api/local/github/repository/preferences",{defaultVisibility:$("defaultVisibility").value});
  $("visibilityNotice").textContent="Default visibility saved: "+result.defaultVisibility+".";
 }catch(e){$("visibilityNotice").textContent=e.message;}
 finally{button.disabled=false;}
});
$("refreshRepoRequests").addEventListener("click",()=>loadRepositoryPreferences().catch(e=>$("visibilityNotice").textContent=e.message));

async function loadApprovalPreferences(){
 const config=await api("/api/local/approval-settings");
 $("buildApproval").value=config.buildApproval==="automatic"?"1":"0";
 renderApprovalPreference();
}
function renderApprovalPreference(){
 const auto=$("buildApproval").value==="1";
 $("buildApprovalLabel").textContent=auto?"Build without asking":"Ask before starting";
 $("buildApprovalExplanation").textContent=auto?
  "Approved ESP-IDF build profiles may start automatically when requested through Main{Create}. Flashing still requires approval.":
  "Main{Create} waits for your approval before starting its managed build jobs.";
}
$("buildApproval").addEventListener("input",renderApprovalPreference);
$("approvalForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const button=event.currentTarget.querySelector("button");button.disabled=true;
 try{
  const buildApproval=$("buildApproval").value==="1"?"automatic":"review";
  await api("/api/local/approval-settings",{buildApproval,flashApproval:"always"});
  $("approvalNotice").textContent="Saved. Firmware flashing will continue to require separate approval.";
 }catch(e){$("approvalNotice").textContent=e.message;}
 finally{button.disabled=false;}
});
$("resetForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const password=$("resetPassword").value,confirmText=$("resetConfirm").value,button=$("resetSubmit");
 if(confirmText!=="RESET MAINCREATE"){$("resetNotice").textContent="Enter the exact confirmation phrase.";return;}
 if(!window.confirm("Reset the local Main{Create} installation and sign out all users? A private snapshot will be kept on this host. External GitHub resources will remain."))return;
 button.disabled=true;
 try{
  const result=await api("/api/local/installation/reset",{password,confirm:confirmText});
  if(!result.reset)throw Error("Reset not confirmed");
  window.location.replace("/setup");
 }catch(e){$("resetNotice").textContent=e.message;button.disabled=false;}
});


/* Private ChatGPT / OpenAI Secure MCP Tunnel onboarding. All mutations require
   a signed-in admin and the standard Main{Create} CSRF token. */
let aiConnection=null,aiPending=false;
async function loadAiConnection(initial=false){
 const data=await api("/api/local/ai/openai");
 aiConnection=data;
 if(initial||!$("openaiTunnelId").value)$("openaiTunnelId").value=data.tunnelId||"";
 $("openaiKeySaved").textContent=data.keySaved?"(saved securely — leave blank to reuse)":"(required)";
 $("openaiRuntimeKey").placeholder=data.keySaved?"Leave blank to keep existing key":"sk-…";
 const runtime=data.runtime||{},state=!data.configured?"not-configured":
  !data.enabled?"disabled":runtime.state||"connecting";
 const labels={"not-configured":"Not configured","disabled":"Disconnected",
  connecting:"Connecting…",ready:"Ready",error:"Needs attention",stopped:"Stopped"};
 const label=labels[state]||"Checking";
 const badge=$("openaiTunnelStatus");badge.textContent=label;badge.dataset.state=state;
 $("openaiMcpReadiness").textContent=data.enabled?
  (runtime.mcpReady?"Local MCP ready":"Local MCP not yet ready")+" · "+
  (runtime.ready?"Secure tunnel ready for ChatGPT":"OpenAI tunnel not ready yet")+
  " · "+(runtime.clientVersion||"official client"):
  "Local MCP and tunnel are stopped. No connection is active.";
 $("openaiDisconnect").disabled=aiPending||!data.enabled;
 $("openaiForget").disabled=aiPending||!data.configured;
 $("openaiConnect").textContent=data.keySaved?"Save & reconnect":"Save & connect";
 if(state==="error")$("openaiConnectionNotice").textContent=
  runtime.error||"Could not start the tunnel. Check the runtime key, tunnel ID and OpenAI permissions.";
 return data;
}
$("openaiConnectionForm").addEventListener("submit",async event=>{
 event.preventDefault();if(aiPending)return;
 aiPending=true;
 const button=$("openaiConnect");button.disabled=true;
 $("openaiConnectionNotice").textContent="Saving credentials and starting your private tunnel…";
 try{
  const payload={tunnelId:$("openaiTunnelId").value.trim()};
  const key=$("openaiRuntimeKey").value.trim();
  if(key)payload.apiKey=key;
  const data=await api("/api/local/ai/openai/configure",payload);
  $("openaiRuntimeKey").value="";
  $("openaiConnectionNotice").textContent=data.runtime?.state==="error"?
   "Settings saved, but the tunnel could not start. Review connection status.":
   "Settings saved. The connection is starting; readiness is checked automatically.";
 }catch(e){$("openaiConnectionNotice").textContent=e.message;}
 finally{aiPending=false;button.disabled=false;await loadAiConnection().catch(()=>{});}
});
$("openaiDisconnect").addEventListener("click",async()=>{
 if(aiPending)return;
 aiPending=true;$("openaiDisconnect").disabled=true;
 try{
  await api("/api/local/ai/openai/disable",{});
  $("openaiConnectionNotice").textContent="Disconnected. Your encrypted credentials are retained for reconnection.";
 }catch(e){$("openaiConnectionNotice").textContent=e.message;}
 finally{aiPending=false;await loadAiConnection().catch(()=>{});}
});
$("openaiForget").addEventListener("click",async()=>{
 if(aiPending||!confirm("Disconnect and remove the saved OpenAI tunnel credentials from this Main{Create} installation?"))return;
 aiPending=true;$("openaiForget").disabled=true;
 try{
  await api("/api/local/ai/openai/remove",{});
  $("openaiTunnelId").value="";$("openaiRuntimeKey").value="";
  $("openaiConnectionNotice").textContent="Local tunnel credentials removed.";
 }catch(e){$("openaiConnectionNotice").textContent=e.message;}
 finally{aiPending=false;await loadAiConnection().catch(()=>{});}
});
$("openaiRefresh").addEventListener("click",async()=>{
 try{await loadAiConnection();$("openaiConnectionNotice").textContent="Connection status refreshed.";}
 catch(e){$("openaiConnectionNotice").textContent=e.message;}
});
// Readiness can change after a key or network error. Never re-send secrets during polls.
setInterval(()=>{
 if(csrf&&!aiPending&&document.visibilityState==="visible")loadAiConnection().catch(()=>{});
},8000);
