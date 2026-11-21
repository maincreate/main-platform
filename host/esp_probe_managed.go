package main

// A typed Fabric operation that only identifies a physically attached ESP32.
// Flash, backup, erase, and efuse writes are intentionally unavailable.
import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "runtime"
 "time"
)

func probeESP32Managed(c config,jobID,port string)(string,error){
 if runtime.GOOS!="linux"{return "",errors.New("ESP32 USB probing requires Linux")}
 if !smokeJobPattern.MatchString(jobID){return "",errors.New("invalid probe job identifier")}
 // Validate before constructing a fixed EIM command string. No caller can
 // supply additional options, shell metacharacters, or another command.
 if err:=validateESP32Port(port);err!=nil{return "",err}
 const version="5.5.6"
 eim:=eimBinaryPath(runtime.GOARCH)
 if err:=checkEIMVersion(eim);err!=nil{return "",fmt.Errorf("EIM runtime unavailable: %w",err)}
 if err:=checkESPIdfVersion(eim,version);err!=nil{return "",fmt.Errorf("ESP-IDF runtime unavailable: %w",err)}
 home:=espRuntimeHome()
 ctx,cancel:=context.WithTimeout(context.Background(),45*time.Second)
 defer cancel()
 run:=func(subcommand string)(string,error){
  // EIM's run command takes a single command string. The only variable
  // segment is the previously validated canonical USB device path.
  return runBoundedCommand(ctx,home,home,eim,
   "--do-not-track","true","run",
   "python -m esptool --port "+port+" "+subcommand,"v"+version)
 }
 chip,err:=run("chip-id");if err!=nil{return "",fmt.Errorf("read-only chip identification failed: %w",err)}
 mac,err:=run("read-mac");if err!=nil{return "",fmt.Errorf("read-only MAC identification failed: %w",err)}
 flash,err:=run("flash-id");if err!=nil{return "",fmt.Errorf("read-only flash identification failed: %w",err)}
 result,err:=parseESP32ProbeThree(port,chip,mac,flash);if err!=nil{return "",err}
 // A successful probe is NOT a security-state check and NOT flash approval.
 result.SecurityVerified=false
 result.FlashAllowed=false
 report,err:=json.MarshalIndent(result,"","  ");if err!=nil{return "",err}
 if err:=uploadFabricAsset(c,jobID,"esp32-device-probe.json","application/json",report);err!=nil{return "",err}
 return "Read-only ESP32 probe completed; identity report uploaded (flash remains disabled)",nil
}
