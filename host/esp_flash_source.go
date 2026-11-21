package main

// Firmware source is always an authenticated, immutable Main{Create} build.
// Never fetch caller-supplied URLs, shell commands, or arbitrary asset names.
import (
 "crypto/sha256"
 "encoding/base64"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "regexp"
)

var flashArtifactNames=[]string{
 "esp32s3-bootloader.bin","esp32s3-partitions.bin","esp32s3-firmware.bin",
}
const flashManifestName="esp32s3-firmware-manifest.json"
const flashSourceMaxBytes=8*1024*1024
var sha256HexPattern=regexp.MustCompile(`^[a-f0-9]{64}$`)

type flashManifestFile struct {
 Name string `json:"name"`
 Size int `json:"size"`
 SHA256 string `json:"sha256"`
}
type flashSourceManifest struct {
 Schema int `json:"schema"`
 JobID string `json:"job_id"`
 Framework string `json:"framework"`
 FrameworkVersion string `json:"framework_version"`
 Target string `json:"target"`
 SourceSHA256 string `json:"source_sha256"`
 Files []flashManifestFile `json:"files"`
}
type flashAssetResponse struct {
 Asset struct{
  Name string `json:"name"`
  Size int `json:"size"`
  SHA256 string `json:"sha256"`
 } `json:"asset"`
 Offset int `json:"offset"`
 ContentBase64 string `json:"content_base64"`
 NextOffset int `json:"next_offset"`
 Complete bool `json:"complete"`
}
func fetchFlashSourceAsset(c config,flashJobID,sourceJobID,name string)([]byte,error){
 if !smokeJobPattern.MatchString(flashJobID)||!smokeJobPattern.MatchString(sourceJobID){
  return nil,errors.New("invalid reviewed flash/source job IDs")
 }
 allowed:=name==flashManifestName
 for _,candidate:=range flashArtifactNames{if name==candidate{allowed=true}}
 if !allowed{return nil,errors.New("requested firmware filename not allowlisted")}
 var payload []byte
 size:=-1
 recordedHash:=""
 for offset:=0;;{
  var reply flashAssetResponse
  err:=post(c.Controller,"/api/agent/assets",c.Token,map[string]any{
   "id":c.ID,"job_id":flashJobID,"action":"source_get",
   "source_job_id":sourceJobID,"name":name,"offset":offset,"length":48*1024,
  },&reply)
  if err!=nil{return nil,err}
  if reply.Asset.Name!=name||reply.Asset.Size<1||
     reply.Asset.Size>flashSourceMaxBytes||reply.Offset!=offset||
     reply.NextOffset<=offset||reply.NextOffset>reply.Asset.Size{
   return nil,errors.New("controller returned invalid firmware source metadata")
  }
  if size<0{size=reply.Asset.Size;recordedHash=reply.Asset.SHA256}
  if size!=reply.Asset.Size||recordedHash!=reply.Asset.SHA256{
   return nil,errors.New("firmware source metadata changed during download")
  }
  chunk,err:=base64.StdEncoding.Strict().DecodeString(reply.ContentBase64)
  if err!=nil||len(chunk)<1||len(chunk)>48*1024||reply.NextOffset!=offset+len(chunk){
   return nil,errors.New("invalid firmware source chunk")
  }
  payload=append(payload,chunk...)
  offset=reply.NextOffset
  if reply.Complete{
   if offset!=size{return nil,errors.New("source payload incomplete")}
   digest:=sha256.Sum256(payload)
   if hex.EncodeToString(digest[:])!=recordedHash{return nil,errors.New("source SHA-256 mismatch")}
   return payload,nil
  }
 }
}
func verifyFlashSourceBundle(sourceJobID string,manifestBytes []byte,images map[string][]byte)error{
 var m flashSourceManifest
 if err:=json.Unmarshal(manifestBytes,&m);err!=nil{return err}
 if m.Schema!=1||m.JobID!=sourceJobID||m.Framework!="esp-idf"||
    m.FrameworkVersion!="5.5.6"||m.Target!="esp32s3"||
    !sha256HexPattern.MatchString(m.SourceSHA256)||len(m.Files)!=len(flashArtifactNames){
  return errors.New("firmware build manifest not an approved ESP32-S3 release")
 }
 seen:=map[string]bool{}
 for _,record:=range m.Files{
  allowed:=false
  for _,name:=range flashArtifactNames{if name==record.Name{allowed=true}}
  if !allowed||seen[record.Name]||!sha256HexPattern.MatchString(record.SHA256){
   return errors.New("firmware manifest contains unknown or duplicate images")
  }
  seen[record.Name]=true
  image,ok:=images[record.Name]
  if !ok||record.Size!=len(image)||record.Size<1024||record.Size>flashSourceMaxBytes{
   return fmt.Errorf("firmware image %s missing or outside size limit",record.Name)
  }
  digest:=sha256.Sum256(image)
  if hex.EncodeToString(digest[:])!=record.SHA256{return errors.New("firmware image SHA-256 mismatch")}
 }
 return nil
}
func fetchVerifiedFlashBundle(c config,flashJobID,sourceJobID string)(map[string][]byte,error){
 manifest,err:=fetchFlashSourceAsset(c,flashJobID,sourceJobID,flashManifestName)
 if err!=nil{return nil,err}
 images:=make(map[string][]byte,len(flashArtifactNames))
 for _,name:=range flashArtifactNames{
  data,e:=fetchFlashSourceAsset(c,flashJobID,sourceJobID,name)
  if e!=nil{return nil,e}
  images[name]=data
 }
 if err:=verifyFlashSourceBundle(sourceJobID,manifest,images);err!=nil{return nil,err}
 return images,nil
}
