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
 esp32ChipPattern=regexp.MustCompile(`(?mi)^Chip is (ESP32(?:-[A-Za-z0-9]+)?)(?:\s|\(|$)`)
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

func parseESP32Probe(port,chipOutput,flashOutput string)(esp32Probe,error){
 result:=esp32Probe{Port:port,SecurityVerified:false,FlashAllowed:false}
 chips:=esp32ChipPattern.FindAllStringSubmatch(chipOutput,-1)
 macs:=esp32MACPattern.FindAllStringSubmatch(chipOutput,-1)
 sizes:=esp32FlashPattern.FindAllStringSubmatch(flashOutput,-1)
 if len(chips)!=1||len(macs)!=1||len(sizes)!=1 {
  return result,errors.New("incomplete or ambiguous active ESP32 chip probe")
 }
 result.Chip=chips[0][1]
 result.MAC=strings.ToLower(macs[0][1])
 result.FlashSize=sizes[0][1]
 return result,nil
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
 chip,err:=run("chip_id");if err!=nil{return esp32Probe{},err}
 flash,err:=run("flash_id");if err!=nil{return esp32Probe{},err}
 return parseESP32Probe(port,chip,flash)
}
