package main

// Fixed-source ESP32-S3 smoke build. This does not check out arbitrary code or
// access USB; it verifies that an EIM-managed IDF can compile a real firmware
// image and publish immutable SHA-256 artifacts to the controller.
import (
 "context"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "regexp"
 "runtime"
 "time"
)

const smokeProjectName="maincreate-smoke"
const smokeMainC="#include \"esp_log.h\"\nstatic const char *TAG = \"MainCreate\";\nvoid app_main(void) { ESP_LOGI(TAG, \"MainCreate ESP32-S3 build verification\"); }\n"
const smokeRootCMake="cmake_minimum_required(VERSION 3.16)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(maincreate-smoke)\n"
const smokeMainCMake="idf_component_register(SRCS \"main.c\" INCLUDE_DIRS \".\")\n"
var smokeJobPattern=regexp.MustCompile(`^[a-f0-9]{32}$`)

func writeSmokeSources(project string)error{
 if err:=os.MkdirAll(filepath.Join(project,"main"),0700);err!=nil{return err}
 for _,file:=range []struct{name,source string}{
  {"CMakeLists.txt",smokeRootCMake},
  {"main/CMakeLists.txt",smokeMainCMake},
  {"main/main.c",smokeMainC},
 }{
  if err:=os.WriteFile(filepath.Join(project,file.name),[]byte(file.source),0644);err!=nil{return err}
 }
 return nil
}
func buildESPIdfSmoke(c config,jobID,version string)(string,error){
 if runtime.GOOS!="linux"||version!="5.5.6"{return "",errors.New("ESP32-S3 smoke build supports installed ESP-IDF 5.5.6 only")}
 if !smokeJobPattern.MatchString(jobID){return "",errors.New("invalid bounded firmware job identifier")}
 eim:=eimBinaryPath(runtime.GOARCH)
 if err:=checkEIMVersion(eim);err!=nil{return "",fmt.Errorf("EIM runtime not available: %w",err)}
 if err:=checkESPIdfVersion(eim,version);err!=nil{return "",fmt.Errorf("required ESP-IDF version not installed: %w",err)}
 project:=filepath.Join(dataDir,"builds","smoke-"+jobID)
 if err:=os.MkdirAll(project,0700);err!=nil{return "",err}
 defer os.RemoveAll(project)
 if err:=writeSmokeSources(project);err!=nil{return "",err}
 home:=espRuntimeHome()
 ctx,cancel:=context.WithTimeout(context.Background(),40*time.Minute);defer cancel()
 if _,err:=runBoundedCommand(ctx,home,project,eim,"--do-not-track","true","run",
  "idf.py set-target esp32s3","v"+version);err!=nil{
  return "",fmt.Errorf("ESP32-S3 smoke target setup failed: %w",err)
 }
 if _,err:=runBoundedCommand(ctx,home,project,eim,"--do-not-track","true","run",
  "idf.py build","v"+version);err!=nil{
  return "",fmt.Errorf("ESP32-S3 firmware compilation failed: %w",err)
 }
 const maxBinary=8<<20
 artifacts:=[]struct{path,name string}{
  {"build/"+smokeProjectName+".bin","esp32s3-firmware.bin"},
  {"build/bootloader/bootloader.bin","esp32s3-bootloader.bin"},
  {"build/partition_table/partition-table.bin","esp32s3-partitions.bin"},
 }
 type manifestAsset struct{Name string `json:"name"`; Size int `json:"size"`; SHA256 string `json:"sha256"`}
 manifest:=struct{
  Schema int `json:"schema"`
  JobID string `json:"job_id"`
  Framework string `json:"framework"`
  FrameworkVersion string `json:"framework_version"`
  Target string `json:"target"`
  SourceSHA256 string `json:"source_sha256"`
  Files []manifestAsset `json:"files"`
 }{Schema:1,JobID:jobID,Framework:"esp-idf",FrameworkVersion:version,Target:"esp32s3"}
 sourceHash:=sha256.Sum256([]byte(smokeRootCMake+smokeMainCMake+smokeMainC))
 manifest.SourceSHA256=hex.EncodeToString(sourceHash[:])
 payloads:=make([][]byte,0,len(artifacts))
 for _,item:=range artifacts{
  data,err:=os.ReadFile(filepath.Join(project,filepath.FromSlash(item.path)))
  if err!=nil{return "",fmt.Errorf("missing built %s: %w",item.path,err)}
  if len(data)<1024||len(data)>maxBinary{return "",fmt.Errorf("built firmware %s outside permitted size",item.path)}
  digest:=sha256.Sum256(data)
  manifest.Files=append(manifest.Files,manifestAsset{
   Name:item.name,Size:len(data),SHA256:hex.EncodeToString(digest[:]),
  })
  payloads=append(payloads,data)
 }
 manifestBytes,err:=json.MarshalIndent(manifest,"","  ");if err!=nil{return "",err}
 // Every binary is verified by the controller before its job is completed.
 for i,item:=range artifacts{
  if err:=uploadFabricAsset(c,jobID,item.name,"application/octet-stream",payloads[i]);err!=nil{return "",err}
 }
 if err:=uploadFabricAsset(c,jobID,"esp32s3-firmware-manifest.json","application/json",manifestBytes);err!=nil{return "",err}
 return fmt.Sprintf("ESP-IDF v%s ESP32-S3 firmware built: 3 binary artifacts and SHA-256 manifest verified",version),nil
}
