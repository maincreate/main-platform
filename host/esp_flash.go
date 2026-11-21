package main

// Guarded ESP32-S3 firmware writer. Never executes unless the controller has
// explicitly released an administrator-approved device-write job with validated
// backup and source evidence. Host repeats hardware checks before every write.
import (
 "context"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "regexp"
 "runtime"
 "strings"
 "time"
)

const flashBaud="460800"
const flashVersion="5.5.6"
var flashSecurityBootDisabled=regexp.MustCompile(`(?m)^Secure Boot: Disabled\s*$`)
var flashEncryptionDisabled=regexp.MustCompile(`(?m)^Flash Encryption: Disabled\s*$`)
var flashSecurityFlagsZero=regexp.MustCompile(`(?m)^Flags: 0x00000000\b`)

func flashSecurityAllowsPlaintext(raw string) error{
 if !flashSecurityBootDisabled.MatchString(raw)||!flashEncryptionDisabled.MatchString(raw)||
   !flashSecurityFlagsZero.MatchString(raw){
  return errors.New("security state unknown or incompatible with unencrypted ESP32-S3 flash")
 }
 return nil
}
func verifyFlashImageLayout(images map[string][]byte)error{
 if len(images)!=3{return errors.New("incomplete ESP32-S3 firmware image set")}
 for _,name:=range flashArtifactNames{
  image,exists:=images[name]
  if !exists||len(image)<1024||len(image)>flashSourceMaxBytes{
   return fmt.Errorf("missing or invalid firmware image: %s",name)
  }
 }
 // ESP-IDF 5.5.6 minimal ESP32-S3 project offsets. Reject any image that
 // overlaps the next section or exceeds the observed 16MB flash capacity.
 if len(images["esp32s3-bootloader.bin"])>0x8000||
  len(images["esp32s3-partitions.bin"])>0x8000||
  len(images["esp32s3-firmware.bin"])>espS3BackupSize-0x10000{
  return errors.New("firmware images overlap ESP32-S3 flash layout")
 }
 return nil
}
func runFlashCommand(ctx context.Context,home,eim,port,command string)(string,error){
 return runBoundedCommand(ctx,home,home,eim,"--do-not-track","true","run",
  "python -m esptool --chip esp32s3 --port "+port+" --baud "+flashBaud+" "+command,
  "v"+flashVersion)
}

func flashESP32Managed(c config,jobID,port,expectedMAC,sourceJobID,backupJobID,securityJobID string)(string,error){
 if runtime.GOOS!="linux"{return "",errors.New("ESP32-S3 flash requires Linux")}
 for _,id:=range []string{jobID,sourceJobID,backupJobID,securityJobID}{
  if !smokeJobPattern.MatchString(id){return "",errors.New("flash requires bounded approved job IDs")}
 }
 if !exactMACPattern.MatchString(expectedMAC){return "",errors.New("exact expected MAC required")}
 if err:=validateESP32Port(port);err!=nil{return "",err}
 if backupJobID==jobID||sourceJobID==jobID||securityJobID==jobID||
    backupJobID==sourceJobID||securityJobID==sourceJobID||backupJobID==securityJobID{
  return "",errors.New("flash evidence jobs must be distinct")
 }
 // The controller must revalidate a completed, full-size, SHA-256 checked
 // backup and a completed security report for this exact MAC and flash job.
 if err:=verifyControllerFlashEvidence(c,jobID,backupJobID,securityJobID,port,expectedMAC);err!=nil{return "",err}
 identity,err:=verifiedESP32Identity(port,expectedMAC)
 if err!=nil{return "",err}
 if identity.Chip!="ESP32-S3"||identity.FlashSize!="16MB"{
  return "",errors.New("active chip or flash size not approved")
 }
 eim:=eimBinaryPath(runtime.GOARCH)
 home:=espRuntimeHome()
 if err:=checkEIMVersion(eim);err!=nil{return "",err}
 if err:=checkESPIdfVersion(eim,flashVersion);err!=nil{return "",err}
 securityCtx,securityCancel:=context.WithTimeout(context.Background(),60*time.Second)
 sec,err:=runFlashCommand(securityCtx,home,eim,port,"get_security_info")
 securityCancel()
 if err!=nil{return "",fmt.Errorf("failed live security inspection: %w",err)}
 if err:=flashSecurityAllowsPlaintext(sec);err!=nil{return "",err}
 images,err:=fetchVerifiedFlashBundle(c,jobID,sourceJobID)
 if err!=nil{return "",err}
 if err:=verifyFlashImageLayout(images);err!=nil{return "",err}
 // Reprobe after artifact retrieval, which can take time. Never use a port
 // descriptor alone to authorize a write to a possibly reconnected device.
 if _,err:=verifiedESP32Identity(port,expectedMAC);err!=nil{return "",fmt.Errorf("device changed before flashing: %w",err)}
 dir:=filepath.Join(dataDir,"flash-staging","pending-"+jobID)
 if err:=os.MkdirAll(dir,0700);err!=nil{return "",err}
 defer os.RemoveAll(dir)
 paths:=make(map[string]string,len(images))
 for _,name:=range flashArtifactNames{
  p:=filepath.Join(dir,name)
  if err:=os.WriteFile(p,images[name],0600);err!=nil{return "",err}
  paths[name]=p
 }
 // The write is the only intentionally destructive operation. Never enable
 // skip-erase or arbitrary arguments. The preset writes only 3 vetted areas.
 pairs:=[]struct{offset,name string}{
  {"0x0","esp32s3-bootloader.bin"},
  {"0x8000","esp32s3-partitions.bin"},
  {"0x10000","esp32s3-firmware.bin"},
 }
 var args []string
 for _,pair:=range pairs{args=append(args,pair.offset,paths[pair.name])}
 ctx,cancel:=context.WithTimeout(context.Background(),8*time.Minute)
 defer cancel()
 command:="write_flash "+strings.Join(args," ")
 if _,err:=runFlashCommand(ctx,home,eim,port,command);err!=nil{
  return "",fmt.Errorf("ESP32-S3 flash failed; recovery backup retained by controller: %w",err)
 }
 // Readback comparison is mandatory, and failure is never reported as success.
 for _,pair:=range pairs{
  verifyCtx,verifyCancel:=context.WithTimeout(context.Background(),90*time.Second)
  _,verifyErr:=runFlashCommand(verifyCtx,home,eim,port,
   "verify_flash "+pair.offset+" "+paths[pair.name])
  verifyCancel()
  if verifyErr!=nil{return "",fmt.Errorf("ESP32-S3 post-write readback verification failed for %s: %w",pair.name,verifyErr)}
 }
 return fmt.Sprintf("ESP32-S3 %s: three source-verified images written and readback-verified; recovery job %s retained",expectedMAC,backupJobID),nil
}
