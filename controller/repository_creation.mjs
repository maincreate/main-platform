// Shared GitHub repository provisioning policy for portal and MCP approval flow.
const problem=(status,message)=>Object.assign(new Error(message),{status});
export const visibilityDefault = value => value === "public" ? "public" : "private";
export function validateRepositoryRequest(input,organization,defaultVisibility="private"){
  if(!input||typeof input!=="object"||Array.isArray(input))throw problem(422,"Repository request must be an object");
  if(typeof organization!=="string"||!/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(organization))throw problem(409,"Select a valid GitHub organization first");
  const name=typeof input.name==="string"?input.name.trim():"";
  if(!/^[a-zA-Z0-9._-]{1,100}$/.test(name)||name==="."||name==="..")
    throw problem(422,"Repository name must contain 1–100 letters, numbers, dots, underscores or hyphens");
  const description=typeof input.description==="string"?input.description.trim():"";
  if(description.length>240)throw problem(422,"Description must be 240 characters or fewer");
  if(input.visibility!==undefined&&input.visibility!=="private"&&input.visibility!=="public")
    throw problem(422,"Visibility must be private or public");
  if(input.organization!==undefined&&input.organization!==organization)
    throw problem(422,"Repository organization must match the connected GitHub organization");
  return {organization,name,description,visibility:input.visibility||visibilityDefault(defaultVisibility)};
}
export async function createOrganizationRepository(request,token,fetchImpl=fetch){
  if(typeof token!=="string"||token.length<20)throw problem(409,"Reconnect GitHub before creating repositories");
  const url="https://api.github.com/orgs/"+encodeURIComponent(request.organization)+"/repos";
  let response;
  try{
    response=await fetchImpl(url,{
      method:"POST",
      headers:{accept:"application/vnd.github+json","content-type":"application/json",
        authorization:"Bearer "+token,"x-github-api-version":"2022-11-28",
        "user-agent":"Main{Create}"},
      body:JSON.stringify({name:request.name,description:request.description,
        private:request.visibility==="private",auto_init:true}),
      signal:AbortSignal.timeout(12000)
    });
  }catch{throw problem(502,"GitHub repository creation could not be reached; check GitHub connectivity");}
  if(response.status===401)throw problem(409,"GitHub authorization has expired; reconnect your account");
  if(response.status===403)throw problem(403,"GitHub denied repository creation. Approve Repository creation: write for this App installation and verify your organization membership");
  if(response.status===422)throw problem(409,"GitHub rejected the repository name or it already exists in the organization");
  if(response.status!==201)throw problem(502,"GitHub repository creation failed (HTTP "+response.status+")");
  const created=await response.json().catch(()=>null);
  if(!created||typeof created.html_url!=="string"||
     !Number.isSafeInteger(created.id)||
     created.owner?.login?.toLowerCase()!==request.organization.toLowerCase()||
     created.private!==(request.visibility==="private")||
     !created.html_url.startsWith("https://github.com/"+request.organization+"/"))
    throw problem(502,"GitHub returned an unexpected repository identity. Check GitHub before retrying");
  return {id:created.id,name:created.name,fullName:created.full_name,
    url:created.html_url,organization:request.organization,visibility:request.visibility};
}
