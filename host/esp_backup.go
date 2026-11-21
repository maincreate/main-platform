package main

// Fixed, read-only full-chip backup of an already identified ESP32-S3.
// Backups are split into bounded 4-MiB authenticated Fabric assets.
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
 "strings"
 "time"
)

const backupPartSize=4*1024*1024
const espS3BackupSize=16*1024*1024
const espBackupVersion="5.5.6"
const backupSerialBaud="460800"
var exactMACPattern=regexp.MustCompile(`^[a-f0-9]{2}(:[a-f0-9]{2}){5}$`)

type firmwareBackupPart struct {
 Name string `json:"name"`
 Offset int64 `json:"offset"`
 Size int `json:"size"`
 SHA256 string `json:"sha256"`
}
type firmwareBackupManifest struct {
 Schema int `json:"schema"`
 JobID string `json:"job_id"`
 Port string `json:"port"`
 Chip string `json:"chip"`
 MAC string `json:"mac"`
 FlashSize string `json:"flash_size"`
 FullSHA256 string `json:"full_sha256"`
 Parts []firmwareBackupPart `json:"parts"`
 FlashAllowed bool `json:"flash_allowed"`
}

func verifiedESP32Identity(port,expectedMAC string)(esp32Probe,error){
 if err:=validateESP32Port(port);err!=nil{return esp32Probe{},err}
 if !exactMACPattern.MatchString(expectedMAC){return esp32Probe{},errors.New("valid lower-case expected MAC required")}
 eim:=eimBinaryPath(runtime.GOARCH)
 if err:=checkEIMVersion(eim);err!=nil{return esp32Probe{},err}
 if err:=checkESPIdfVersion(eim,espBackupVersion);err!=nil{return esp32Probe{},err}
 home:=espRuntimeHome()
 ctx,cancel:=context.WithTimeout(context.Background(),75*time.Second);defer cancel()
 run:=func(command string)(string,error){
  return runBoundedCommand(ctx,home,home,eim,"--do-not-track","true","run",
   "python -m esptool --port "+port+" "+command,"v"+espBackupVersion)
 }
 chip,err:=run(espToolChipCommand);if err!=nil{return esp32Probe{},fmt.Errorf("chip identity unavailable: %w",err)}
 mac,err:=run(espToolMACCommand);if err!=nil{return esp32Probe{},fmt.Errorf("MAC identity unavailable: %w",err)}
 flash,err:=run(espToolFlashCommand);if err!=nil{return esp32Probe{},fmt.Errorf("flash identity unavailable: %w",err)}
 found,err:=parseESP32ProbeThree(port,chip,mac,flash)
 if err!=nil{return esp32Probe{},err}
 if found.Chip!="ESP32-S3"||found.MAC!=expectedMAC||found.FlashSize!="16MB"{
  return esp32Probe{},fmt.Errorf("device identity or 16MB flash capacity mismatch; backup stopped")
 }
 return found,nil
}
func backupESP32Managed(c config,jobID,port,expectedMAC string)(string,error){
 if runtime.GOOS!="linux"{return "",errors.New("ESP32 backup requires Linux")}
 if !smokeJobPattern.MatchString(jobID){return "",errors.New("invalid backup job ID")}
 identity,err:=verifiedESP32Identity(port,expectedMAC);if err!=nil{return "",err}
 dir:=filepath.Join(dataDir,"device-backups","pending-"+jobID)
 if err:=os.MkdirAll(dir,0700);err!=nil{return "",err}
 path:=filepath.Join(dir,"flash.bin")
 defer os.RemoveAll(dir)
 // A fixed amount and a fixed, private destination; no arbitrary offsets,
 // shell input, firmware writes, or caller-selected flash regions.
 home:=espRuntimeHome()
 eim:=eimBinaryPath(runtime.GOARCH)
 ctx,cancel:=context.WithTimeout(context.Background(),15*time.Minute);defer cancel()
 command:="python -m esptool --port "+port+" --baud "+backupSerialBaud+" read_flash 0x0 0x1000000 "+path
 if _,err:=runBoundedCommand(ctx,home,home,eim,"--do-not-track","true","run",command,"v"+espBackupVersion);err!=nil{
  return "",fmt.Errorf("read-only full flash backup failed: %w",err)
 }
 info,err:=os.Lstat(path);if err!=nil{return "",err}
 if !info.Mode().IsRegular()||info.Size()!=espS3BackupSize{return "",errors.New("backup size differs from verified flash capacity")}
 if err:=os.Chmod(path,0600);err!=nil{return "",err}
 // Fail closed on unplug/replug or identity drift during backup.
 if _,err:=verifiedESP32Identity(port,expectedMAC);err!=nil{return "",fmt.Errorf("post-backup device identity changed: %w",err)}
 payload,err:=os.ReadFile(path);if err!=nil{return "",err}
 if len(payload)!=espS3BackupSize{return "",errors.New("backup file truncated")}
 hash:=sha256.Sum256(payload)
 manifest:=firmwareBackupManifest{Schema:1,JobID:jobID,Port:port,
  Chip:identity.Chip,MAC:identity.MAC,FlashSize:identity.FlashSize,
  FullSHA256:hex.EncodeToString(hash[:]),FlashAllowed:false}
 for i:=0;i<len(payload);i+=backupPartSize{
  end:=i+backupPartSize
  part:=payload[i:end]
  digest:=sha256.Sum256(part)
  name:=fmt.Sprintf("esp32s3-backup-%02d.bin",i/backupPartSize)
  if err:=uploadFabricAsset(c,jobID,name,"application/octet-stream",part);err!=nil{return "",err}
  manifest.Parts=append(manifest.Parts,firmwareBackupPart{Name:name,Offset:int64(i),
   Size:len(part),SHA256:hex.EncodeToString(digest[:])})
 }
 raw,err:=json.MarshalIndent(manifest,"","  ");if err!=nil{return "",err}
 if err:=uploadFabricAsset(c,jobID,"esp32s3-backup-manifest.json","application/json",raw);err!=nil{return "",err}
 return fmt.Sprintf("Read-only %s %s 16MB flash backup uploaded in %d SHA-256 verified parts; no writes authorized",
  identity.Chip,strings.ToUpper(identity.MAC),len(manifest.Parts)),nil
}
