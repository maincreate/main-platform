package main

import (
 "strings"
 "testing"
)

func TestManagedProbeRejectsUntrustedPortBeforeEIM(t *testing.T){
 for _,port:=range []string{"", "/dev/ttyUSB0;touch /tmp/owned","/dev/ttyUSB0 --before no_reset","/dev/ttyS0","/tmp/ttyUSB0"}{
  _,err:=probeESP32Managed(config{},"0123456789abcdef0123456789abcdef",port)
  if err==nil{t.Fatalf("untrusted serial path was accepted: %q",port)}
  if strings.Contains(err.Error(),"EIM runtime") {t.Fatalf("EIM reached before validating %q: %v",port,err)}
 }
}
func TestManagedProbeRejectsUntrustedJobID(t *testing.T){
 _,err:=probeESP32Managed(config{},"../escape","/dev/ttyUSB0")
 if err==nil||!strings.Contains(err.Error(),"job identifier"){t.Fatalf("invalid job ID was not rejected first: %v",err)}
}
