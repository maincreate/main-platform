package main

import (
 "testing"
 "encoding/json"
 "encoding/base64"
 "crypto/sha256"
 "encoding/hex"
 "bytes"
 "net/http"
 "net/http/httptest"
)

func TestValidController(t *testing.T) {
 for _,tc:=range []struct{url string;want bool}{
  {"https://controller.example.com",true},{"https://pi.local:8443",true},
  {"http://pi.local",false},{"https://evil.com/path",false},{"https://user@evil.com",false},
 }{
  if validController(tc.url)!=tc.want { t.Fatalf("controller validation %q",tc.url) }
 }
}
func TestNames(t *testing.T){
 for _,s:=range []string{"maincreate-pi","runner_1","tt.arm64"} {if !safeName(s){t.Fatalf("rejected %q",s)}}
 for _,s:=range []string{"../../etc/passwd","bad name","a/b"} {if safeName(s){t.Fatalf("accepted %q",s)}}
}
func TestUnsupportedActions(t *testing.T){
 if err:=execute(&action{Type:"arbitrary.shell"});err==nil {t.Fatal("arbitrary action accepted")}
}

func TestDecommissionActionsRejectInvalid(t *testing.T){
 cases:=[]action{
  {Type:"github-runner.stop",RunnerName:"different-host",ExpiresAt:"2099-01-01T00:00:00Z"},
  {Type:"host.cleanup",RunnerName:hostname(),RegistrationToken:"must-not-be-supplied",ExpiresAt:"2099-01-01T00:00:00Z"},
  {Type:"host.cleanup",RunnerName:hostname(),ExpiresAt:"2000-01-01T00:00:00Z"},
 }
 for _,a:=range cases{
  if e:=execute(&a);e==nil{t.Fatalf("accepted invalid decommission action: %s",a.Type)}
 }
}


func TestManagedFabricSnapshotLifecycle(t *testing.T){
 const jobID="0123456789abcdef0123456789abcdef"
 const assetID="fedcba9876543210fedcba9876543210"
 var uploaded []byte
 calls:=map[string]int{}
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  var body map[string]any
  if err:=json.NewDecoder(r.Body).Decode(&body);err!=nil{t.Errorf("invalid JSON: %v",err);w.WriteHeader(400);return}
  if r.Header.Get("Authorization")!="Bearer test-token"{t.Errorf("missing enrollment bearer token")}
  calls[r.URL.Path]++
  switch r.URL.Path{
  case "/api/agent/jobs/claim":
   caps,ok:=body["capabilities"].([]any)
   if !ok||len(caps)!=1||caps[0]!="host.snapshot"{t.Errorf("unexpected capability filter: %v",body["capabilities"])}
   _=json.NewEncoder(w).Encode(map[string]any{"job":map[string]any{
    "id":jobID,"steps":[]map[string]string{{"capability":"host.snapshot"}}}})
  case "/api/agent/assets":
   switch body["action"]{
   case "begin":
    _=json.NewEncoder(w).Encode(map[string]any{"asset":map[string]string{"id":assetID},"maxChunkBytes":48*1024})
   case "chunk":
    if body["asset_id"]!=assetID{t.Errorf("incorrect asset ID")}
    chunk,err:=base64.StdEncoding.DecodeString(body["content_base64"].(string))
    if err!=nil{t.Errorf("invalid base64: %v",err)}
    if int(body["offset"].(float64))!=len(uploaded){t.Errorf("unexpected chunk offset")}
    uploaded=append(uploaded,chunk...)
    _=json.NewEncoder(w).Encode(map[string]any{"received":len(uploaded)})
   case "finish":
    digest:=sha256.Sum256(uploaded)
    if body["sha256"]!=hex.EncodeToString(digest[:]){t.Errorf("invalid SHA-256")}
    _=json.NewEncoder(w).Encode(map[string]any{"asset":map[string]string{"id":assetID}})
   default:t.Errorf("unexpected asset request: %v",body["action"])
   }
  case "/api/agent/jobs/complete":
   if body["success"]!=true{t.Errorf("job not marked successful")}
   if body["job_id"]!=jobID{t.Errorf("wrong completion job")}
   steps,ok:=body["steps"].([]any)
   if !ok||len(steps)!=1||steps[0].(map[string]any)["status"]!="completed"{t.Errorf("invalid steps: %v",body["steps"])}
   _=json.NewEncoder(w).Encode(map[string]any{"ok":true})
  default:t.Errorf("unexpected endpoint: %s",r.URL.Path);w.WriteHeader(404)
  }
 }))
 defer server.Close()
 c:=config{ID:"test-host",Token:"test-token",Controller:server.URL,Name:"test-host"}
 if err:=pollFabric(c);err!=nil{t.Fatal(err)}
 var report map[string]any
 if err:=json.Unmarshal(uploaded,&report);err!=nil{t.Fatalf("snapshot not valid JSON: %v",err)}
 if report["host"]!="test-host"||report["hostServiceVersion"]!=version{t.Fatalf("wrong host snapshot: %v",report)}
 for _,name:=range []string{"/api/agent/jobs/claim","/api/agent/jobs/complete"}{
  if calls[name]!=1{t.Errorf("%s called %d times",name,calls[name])}
 }
 if !bytes.Contains(uploaded,[]byte("totalMemoryBytes")){t.Fatal("memory inventory missing")}
}

func TestFabricRejectsUnsupportedJobWithoutExecuting(t *testing.T){
 var completed map[string]any
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if r.URL.Path=="/api/agent/jobs/complete"{
   _=json.NewDecoder(r.Body).Decode(&completed)
  }
  _=json.NewEncoder(w).Encode(map[string]any{"ok":true})
 }))
 defer server.Close()
 c:=config{ID:"test-host",Token:"test-token",Controller:server.URL}
 if err:=executeFabricJob(c,fabricJob{ID:"test-job",Steps:[]fabricStep{{Capability:"unsafe.shell"}}});err!=nil{t.Fatal(err)}
 if completed["success"]!=false{t.Fatal("unsupported capability should fail")}
 if completed["logs"]==""{t.Fatal("unsupported capability must log a reason")}
}
