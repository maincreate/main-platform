package main

import (
 "bytes"
 "crypto/sha256"
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "os"
 "path/filepath"
 "testing"
)

func TestFixedESP32S3SmokeProject(t *testing.T){
 project:=filepath.Join(t.TempDir(),"smoke")
 if err:=writeSmokeSources(project);err!=nil{t.Fatal(err)}
 for _,file:=range []string{"CMakeLists.txt","main/CMakeLists.txt","main/main.c"}{
  data,err:=os.ReadFile(filepath.Join(project,file));if err!=nil{t.Fatal(err)}
  if len(data)<10{t.Fatalf("missing fixed source in %s",file)}
 }
 root,_:=os.ReadFile(filepath.Join(project,"CMakeLists.txt"))
 if !bytes.Contains(root,[]byte("project(maincreate-smoke)")){t.Fatal("wrong project name")}
 main,_:=os.ReadFile(filepath.Join(project,"main/main.c"))
 if !bytes.Contains(main,[]byte("app_main")){t.Fatal("sample has no ESP-IDF entry point")}
 if bytes.Contains(main,[]byte("system("))||bytes.Contains(main,[]byte("esp_flash")){
  t.Fatal("smoke source must not shell out or flash a device")
 }
}
func TestSmokeBuildRejectsUnknownVersionsAndUnsafeJobIDs(t *testing.T){
 for _,version:=range []string{"","6.1.1","latest","5.5.6;sh"}{
  if _,err:=buildESPIdfSmoke(config{},"0123456789abcdef0123456789abcdef",version);err==nil{
   t.Fatalf("accepted unvalidated SDK version %q",version)
  }
 }
 for _,id:=range []string{"test-job","../other","deadbeef;rm",""}{
  if _,err:=buildESPIdfSmoke(config{},id,"5.5.6");err==nil{
   t.Fatalf("accepted unsafe job identifier %q",id)
  }
 }
}
func TestFabricBinaryArtifactUploadHasVerifiedDigestAndChunks(t *testing.T){
 const jobID="0123456789abcdef0123456789abcdef"
 const assetID="abcdef0123456789abcdef0123456789"
 data:=bytes.Repeat([]byte{0x42,0x49,0x4e,0x00,0xf3,0xfa,0xee},8000)
 var uploaded []byte
 requests:=0
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  requests++
  var body map[string]any
  if e:=json.NewDecoder(r.Body).Decode(&body);e!=nil{t.Errorf("bad JSON: %v",e);w.WriteHeader(400);return}
  if r.Header.Get("Authorization")!="Bearer firmware-test-token"{t.Error("missing bearer token")}
  if body["job_id"]!=jobID{t.Error("wrong job ID")}
  switch body["action"]{
  case "begin":
   if body["name"]!="esp32s3-firmware.bin"||body["mime"]!="application/octet-stream"{
    t.Errorf("wrong binary artifact metadata: %v",body)
   }
   _=json.NewEncoder(w).Encode(map[string]any{"asset":map[string]string{"id":assetID},"maxChunkBytes":48*1024})
  case "chunk":
   chunk,e:=base64.StdEncoding.DecodeString(body["content_base64"].(string))
   if e!=nil{t.Errorf("invalid content: %v",e)}
   if int(body["offset"].(float64))!=len(uploaded){t.Error("out-of-order upload")}
   uploaded=append(uploaded,chunk...)
   _=json.NewEncoder(w).Encode(map[string]any{"received":len(uploaded)})
  case "finish":
   sha:=sha256.Sum256(uploaded)
   if body["sha256"]!=hex.EncodeToString(sha[:]){t.Error("wrong final digest")}
   _=json.NewEncoder(w).Encode(map[string]any{"asset":map[string]string{"id":assetID}})
  default:t.Errorf("unexpected action %v",body["action"])
  }
 }))
 defer server.Close()
 c:=config{ID:"test-host",Token:"firmware-test-token",Controller:server.URL}
 if err:=uploadFabricAsset(c,jobID,"esp32s3-firmware.bin","application/octet-stream",data);err!=nil{t.Fatal(err)}
 if !bytes.Equal(uploaded,data)||requests<3{t.Fatal("firmware bytes not fully uploaded")}
 if err:=uploadFabricAsset(c,jobID,"test.bin","application/octet-stream",nil);err==nil{
  t.Fatal("empty firmware artifact accepted")
 }
}
