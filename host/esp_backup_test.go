package main

import (
 "strings"
 "testing"
)

func TestManagedBackupRejectsInvalidJobAndPortBeforeAnyHardwareWork(t *testing.T){
 _,err:=backupESP32Managed(config{},"../escape","/dev/ttyACM0","44:bd:8d:78:15:e8")
 if err==nil||!strings.Contains(err.Error(),"job ID"){t.Fatalf("unexpected invalid job result: %v",err)}
 for _,port:=range []string{"/dev/ttyS0","/dev/ttyACM0;sh","/tmp/ttyACM0",""}{
  _,err:=backupESP32Managed(config{},"0123456789abcdef0123456789abcdef",port,"44:bd:8d:78:15:e8")
  if err==nil||!strings.Contains(err.Error(),"canonical"){t.Fatalf("untrusted port %q was not rejected: %v",port,err)}
 }
}
func TestBackupConstantsRemainWithinFabricUploadLimit(t *testing.T){
 if backupPartSize!=4*1024*1024||espS3BackupSize!=16*1024*1024{
  t.Fatalf("unexpected backup bounds: %d / %d",backupPartSize,espS3BackupSize)
 }
 if espS3BackupSize%backupPartSize!=0||backupPartSize>8*1024*1024{
  t.Fatal("backup is not evenly split into permitted Fabric asset sizes")
 }
 if espBackupVersion!="5.5.6"{t.Fatal("backup must use the vetted installed esptool")}
}
func TestExpectedDeviceIdentityRequiresCanonicalMAC(t *testing.T){
 for _,mac:=range []string{"","44:BD:8D:78:15:E8","44:bd:8d:78:15:e8;sh","44:bd:8d:78:15","zz:bd:8d:78:15:e8"}{
  if exactMACPattern.MatchString(mac){t.Fatalf("accepted invalid MAC: %q",mac)}
 }
 if !exactMACPattern.MatchString("44:bd:8d:78:15:e8"){t.Fatal("expected valid canonical device MAC")}
}
