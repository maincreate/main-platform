package main

import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "testing"
 "strings"
 "bytes"
 "net/http"
 "net/http/httptest"
 "encoding/base64"
)

func TestFlashBundleRejectsUnreviewedOrModifiedFirmware(t *testing.T){
 sourceID:="0123456789abcdef0123456789abcdef"
 images:=map[string][]byte{}
 manifest:=flashSourceManifest{Schema:1,JobID:sourceID,Framework:"esp-idf",FrameworkVersion:"5.5.6",
  Target:"esp32s3",SourceSHA256:strings.Repeat("a",64)}
 for i,name:=range flashArtifactNames{
  data:=make([]byte,1024+i*64);for j:=range data{data[j]=byte(i+j)}
  images[name]=data
  hash:=sha256.Sum256(data)
  manifest.Files=append(manifest.Files,flashManifestFile{Name:name,Size:len(data),SHA256:hex.EncodeToString(hash[:])})
 }
 encoded,_:=json.Marshal(manifest)
 if err:=verifyFlashSourceBundle(sourceID,encoded,images);err!=nil{t.Fatal(err)}
 if err:=verifyFlashSourceBundle("f"+sourceID[1:],encoded,images);err==nil{t.Fatal("source job ID must match")}
 images["esp32s3-firmware.bin"][7]^=0xff
 if err:=verifyFlashSourceBundle(sourceID,encoded,images);err==nil{t.Fatal("modified firmware accepted")}
 images["esp32s3-firmware.bin"][7]^=0xff
 manifest.Files[0].Name="../bootloader.bin"
 encoded,_=json.Marshal(manifest)
 if err:=verifyFlashSourceBundle(sourceID,encoded,images);err==nil{t.Fatal("unknown source name accepted")}
}

func TestFlashSourceTransportChecksSHAAndBoundaries(t *testing.T){
 payload:=bytes.Repeat([]byte("reviewed-firmware"),4500)
 hash:=sha256.Sum256(payload)
 const job="0123456789abcdef0123456789abcdef"
 const source="fedcba9876543210fedcba9876543210"
 tamper:=false
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  var req map[string]any
  if e:=json.NewDecoder(r.Body).Decode(&req);e!=nil{t.Error(e);w.WriteHeader(400);return}
  if req["action"]!="source_get"||req["source_job_id"]!=source||req["job_id"]!=job||req["name"]!="esp32s3-firmware.bin"{
   t.Errorf("unexpected firmware source request: %v",req)
  }
  offset:=int(req["offset"].(float64))
  end:=offset+48*1024
  if end>len(payload){end=len(payload)}
  chunk:=payload[offset:end]
  if tamper&&offset==0{chunk=bytes.Clone(chunk);chunk[0]^=1}
  _=json.NewEncoder(w).Encode(map[string]any{
   "asset":map[string]any{"name":"esp32s3-firmware.bin","size":len(payload),"sha256":hex.EncodeToString(hash[:])},
   "offset":offset,"content_base64":base64.StdEncoding.EncodeToString(chunk),
   "next_offset":end,"complete":end==len(payload),
  })
 }))
 defer server.Close()
 c:=config{Controller:server.URL,Token:"test-token",ID:"test-host"}
 result,e:=fetchFlashSourceAsset(c,job,source,"esp32s3-firmware.bin")
 if e!=nil{t.Fatal(e)}
 if !bytes.Equal(result,payload){t.Fatal("firmware source changed in transport")}
 tamper=true
 if _,e=fetchFlashSourceAsset(c,job,source,"esp32s3-firmware.bin");e==nil{t.Fatal("accepted tampered firmware")}
 if _,e=fetchFlashSourceAsset(c,job,source,"../secret");e==nil{t.Fatal("accepted arbitrary firmware source name")}
 if _,e=fetchFlashSourceAsset(c,"invalid",source,"esp32s3-firmware.bin");e==nil{t.Fatal("accepted invalid job ID")}
}

func TestFlashBundleAcceptsPinnedArduinoSourceOnly(t *testing.T){
 sourceID:="0123456789abcdef0123456789abcdef"
 images:=map[string][]byte{}
 manifest:=flashSourceManifest{Schema:1,JobID:sourceID,Framework:"arduino-esp32",
  FrameworkVersion:"3.2.0",Target:"esp32s3",SourceSHA256:strings.Repeat("b",64)}
 for i,name:=range flashArtifactNames{
  data:=bytes.Repeat([]byte{byte(i+1)},2048+i*1024)
  images[name]=data
  sum:=sha256.Sum256(data)
  manifest.Files=append(manifest.Files,flashManifestFile{Name:name,Size:len(data),
   SHA256:hex.EncodeToString(sum[:])})
 }
 raw,_:=json.Marshal(manifest)
 if err:=verifyFlashSourceBundle(sourceID,raw,images);err!=nil{t.Fatal(err)}
 manifest.FrameworkVersion="3.2.1"
 raw,_=json.Marshal(manifest)
 if err:=verifyFlashSourceBundle(sourceID,raw,images);err==nil{t.Fatal("accepted unreviewed Arduino SDK")}
}
