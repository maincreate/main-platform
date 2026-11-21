package main

// A bounded, read-only security interrogation. Actual firmware writes must
// separately validate efuse state and require explicit human approval.
import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "runtime"
 "strings"
 "time"
)

type esp32SecurityReport struct {
 Schema int `json:"schema"`
 Port string `json:"port"`
 Chip string `json:"chip"`
 MAC string `json:"mac"`
 FlashSize string `json:"flash_size"`
 RawSecurityInfo string `json:"raw_security_info"`
 SecurityVerified bool `json:"security_verified"`
 FlashAllowed bool `json:"flash_allowed"`
}

func esp32SecurityPreflight(c config,jobID,port,expectedMAC string)(string,error){
 if runtime.GOOS!="linux"{return "",errors.New("ESP32 security inspection requires Linux")}
 if !smokeJobPattern.MatchString(jobID){return "",errors.New("invalid security inspection job ID")}
 identity,err:=verifiedESP32Identity(port,expectedMAC);if err!=nil{return "",err}
 home:=espRuntimeHome()
 eim:=eimBinaryPath(runtime.GOARCH)
 ctx,cancel:=context.WithTimeout(context.Background(),60*time.Second);defer cancel()
 output,err:=runBoundedCommand(ctx,home,home,eim,
  "--do-not-track","true","run",
  "python -m esptool --port "+port+" get_security_info","v"+espBackupVersion)
 if err!=nil{return "",fmt.Errorf("read-only ESP32 security interrogation failed: %w",err)}
 if len(output)<16||len(output)>6000{return "",errors.New("ESP32 security response outside bounds")}
 if !strings.Contains(strings.ToLower(output),"security"){return "",errors.New("security tool did not produce a recognizable report")}
 report:=esp32SecurityReport{
  Schema:1,Port:port,Chip:identity.Chip,MAC:identity.MAC,FlashSize:identity.FlashSize,
  RawSecurityInfo:output,SecurityVerified:false,FlashAllowed:false,
 }
 raw,err:=json.MarshalIndent(report,"","  ");if err!=nil{return "",err}
 if err:=uploadFabricAsset(c,jobID,"esp32-security-info.json","application/json",raw);err!=nil{return "",err}
 return "Read-only ESP32-S3 security evidence uploaded; firmware writes remain disabled",nil
}
