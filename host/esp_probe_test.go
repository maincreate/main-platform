package main

import (
 "os"
 "path/filepath"
 "testing"
)

func TestESP32ProbeParsesCompleteIdentity(t *testing.T){
 chip:="esptool v5.0\nChip is ESP32-S3 (QFN56)\nMAC: 24:58:7c:11:22:ab\n"
 flash:="Manufacturer: 20\nDetected flash size: 8MB\n"
 got,err:=parseESP32Probe("/dev/ttyUSB0",chip,flash)
 if err!=nil{t.Fatal(err)}
 if got.Chip!="ESP32-S3"||got.MAC!="24:58:7c:11:22:ab"||got.FlashSize!="8MB"{t.Fatalf("wrong identity: %+v",got)}
 if got.SecurityVerified||got.FlashAllowed{t.Fatal("read-only identification must not authorize flashing")}
}

func TestESP32ProbeFailsClosed(t *testing.T){
 tests:=[]struct{name,chip,flash string}{
  {"missing MAC","Chip is ESP32-S3","Detected flash size: 8MB"},
  {"missing chip","MAC: 24:58:7c:11:22:ab","Detected flash size: 8MB"},
  {"missing flash","Chip is ESP32-S3\nMAC: 24:58:7c:11:22:ab",""},
  {"conflicting chip","Chip is ESP32-S3\nChip is ESP32-C3\nMAC: 24:58:7c:11:22:ab","Detected flash size: 8MB"},
  {"conflicting MAC","Chip is ESP32-S3\nMAC: 24:58:7c:11:22:ab\nMAC: 24:58:7c:11:22:ac","Detected flash size: 8MB"},
 }
 for _,tc:=range tests{t.Run(tc.name,func(t *testing.T){
  if _,err:=parseESP32Probe("/dev/ttyUSB0",tc.chip,tc.flash);err==nil{t.Fatal("accepted ambiguous identity")}
 })}
}

func TestESP32PortRejectsInjectionAndRegularFile(t *testing.T){
 for _,port:=range []string{"/dev/ttyUSB0;sh","/dev/ttyUSB0/../zero","/tmp/ttyUSB0","/dev/ttyS0","/dev/ttyACM0 --before no_reset"}{
  if err:=validateESP32Port(port);err==nil{t.Fatalf("accepted port %q",port)}
 }
 dir:=t.TempDir()
 path:=filepath.Join(dir,"ttyUSB0")
 if err:=os.WriteFile(path,[]byte("not a serial device"),0600);err!=nil{t.Fatal(err)}
 if err:=validateESP32Port(path);err==nil{t.Fatal("accepted regular file")}
}

func TestESP32ProbeRejectsNonAbsoluteEsptool(t *testing.T){
 if _,err:=probeESP32ReadOnly("/dev/ttyUSB0","esptool");err==nil{t.Fatal("accepted untrusted command search path")}
}
