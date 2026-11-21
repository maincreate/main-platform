package main

// Read-only ESP32 identification primitives. These functions deliberately do
// not register a Fabric capability, enable device writes, or infer flash safety.
import (
 "context"
 "errors"
 "fmt"
 "os"
 "os/exec"
 "path/filepath"
 "regexp"
 "strings"
 "time"
)

// ESP-IDF v5.5.6 bundles the esptool CLI with legacy underscored actions.
const espToolChipCommand="chip_id"
const espToolMACCommand="read_mac"
const espToolFlashCommand="flash_id"

type esp32Probe struct {
 Port string `json:"port"`
 Chip string `json:"chip"`
 MAC string `json:"mac"`
 FlashSize string `json:"flash_size"`
 SecurityVerified bool `json:"security_verified"`
 FlashAllowed bool `json:"flash_allowed"`
}

var (
 esp32PortName=regexp.MustCompile(`^/dev/(ttyUSB[0-9]+|ttyACM[0-9]+)$`)
 esp32ChipPattern=regexp.MustCompile(`(?mi)^(?:Chip is |Chip type: |Detecting chip type\.\.\.\s*)(ESP32(?:-[A-Za-z0-9]+)?)(?:\s|\(|$)`)
 esp32MACPattern=regexp.MustCompile(`(?mi)^(?:MAC|Base MAC):\s*([a-f0-9]{2}(?::[a-f0-9]{2}){5})\s*$`)
 esp32FlashPattern=regexp.MustCompile(`(?mi)^Detected flash size:\s*([0-9]+(?:KB|MB))\s*$`)
)

func validateESP32Port(port string) error {
 if !esp32PortName.MatchString(port) {return errors.New("ESP32 probe requires a canonical Linux USB serial port")}
 info,err:=os.Lstat(port)
 if err!=nil{return fmt.Errorf("serial port not present: %w",err)}
 // A symlink is never an acceptable claim of physical device identity.
 if info.Mode()&os.ModeSymlink!=0{return errors.New("serial port symlink rejected")}
 if info.Mode()&os.ModeCharDevice==0{return errors.New("serial port is not a character device")}
 return nil
}

func uniqueProbeValues(matches [][]string) []string {
 var values []string
 seen:=make(map[string]bool)
 for _,match:=range matches{
  if len(match)<2{continue}
  value:=strings.ToLower(match[1])
  if !seen[value]{seen[value]=true;values=append(values,match[1])}
 }
 return values
}
func parseESP32ProbeThree(port,chipOutput,macOutput,flashOutput string)(esp32Probe,error){
 result:=esp32Probe{Port:port,SecurityVerified:false,FlashAllowed:false}
 chips:=uniqueProbeValues(esp32ChipPattern.FindAllStringSubmatch(chipOutput,-1))
 macs:=uniqueProbeValues(esp32MACPattern.FindAllStringSubmatch(macOutput,-1))
 sizes:=uniqueProbeValues(esp32FlashPattern.FindAllStringSubmatch(flashOutput,-1))
 if len(chips)!=1||len(macs)!=1||len(sizes)!=1 {
  // Report only missing/conflicting field counts, never raw serial responses.
  return result,fmt.Errorf("incomplete or ambiguous ESP32 identity (chip=%d mac=%d flash=%d)",len(chips),len(macs),len(sizes))
 }
 result.Chip=chips[0]
 result.MAC=strings.ToLower(macs[0])
 result.FlashSize=strings.ToUpper(sizes[0])
 return result,nil
}
// Legacy parser retained for existing fixtures where chip_id also includes MAC.
// Modern esptool versions require a distinct read-mac command instead.
func parseESP32Probe(port,chipOutput,flashOutput string)(esp32Probe,error){
 return parseESP32ProbeThree(port,chipOutput,chipOutput,flashOutput)
}

// probeESP32ReadOnly must receive a trusted, absolute, operator-installed
// esptool executable path. It runs only the fixed esptool subcommands chip_id
// and flash_id; this intentionally does not erase or write any flash.
func probeESP32ReadOnly(port,esptoolPath string)(esp32Probe,error){
 if err:=validateESP32Port(port);err!=nil{return esp32Probe{},err}
 if !filepath.IsAbs(esptoolPath) {return esp32Probe{},errors.New("esptool path must be absolute")}
 info,err:=os.Stat(esptoolPath)
 if err!=nil{return esp32Probe{},err}
 if !info.Mode().IsRegular()||info.Mode().Perm()&0111==0 {
  return esp32Probe{},errors.New("esptool executable is invalid")
 }
 ctx,cancel:=context.WithTimeout(context.Background(),30*time.Second);defer cancel()
 run:=func(command string)(string,error){
  cmd:=exec.CommandContext(ctx,esptoolPath,"--port",port,command)
  output,err:=cmd.CombinedOutput()
  if err!=nil{return "",fmt.Errorf("ESP32 %s probe failed: %w",command,err)}
  if len(output)>16*1024{return "",errors.New("ESP32 probe output exceeds limit")}
  return string(output),nil
 }
 chip,err:=run(espToolChipCommand);if err!=nil{return esp32Probe{},err}
 mac,err:=run(espToolMACCommand);if err!=nil{return esp32Probe{},err}
 flash,err:=run(espToolFlashCommand);if err!=nil{return esp32Probe{},err}
 return parseESP32ProbeThree(port,chip,mac,flash)
}
