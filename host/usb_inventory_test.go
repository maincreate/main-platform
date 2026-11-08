package main

import (
 "os"
 "path/filepath"
 "testing"
)
func TestUSBInventoryReadOnly(t *testing.T){
 root:=t.TempDir()
 sys:=filepath.Join(root,"sys","class","tty")
 usb:=filepath.Join(root,"sys","devices","1-2")
 leaf:=filepath.Join(usb,"1-2:1.0","tty","ttyACM0")
 for _,dir:=range []string{sys,leaf}{if err:=os.MkdirAll(dir,0755);err!=nil{t.Fatal(err)}}
 for k,v:=range map[string]string{"idVendor":"303a\n","idProduct":"1001\n","serial":"ABC123\n","manufacturer":"Espressif\n","product":"USB JTAG/serial debug unit\n"}{
  if err:=os.WriteFile(filepath.Join(usb,k),[]byte(v),0644);err!=nil{t.Fatal(err)}
 }
 if err:=os.MkdirAll(filepath.Join(sys,"ttyACM0"),0755);err!=nil{t.Fatal(err)}
 if err:=os.Symlink(leaf,filepath.Join(sys,"ttyACM0","device"));err!=nil{t.Fatal(err)}
 found,err:=scanUSBSerialAt(sys)
 if err!=nil||len(found)!=1{t.Fatalf("scan: %v %+v",err,found)}
 got:=found[0]
 if got.Port!="/dev/ttyACM0"||got.VID!=0x303a||got.PID!=0x1001||
  got.SerialNumber!="ABC123"||got.Location!="1-2"{t.Fatalf("unexpected descriptor: %+v",got)}
 if _,err:=os.Stat("/dev/ttyACM0");err==nil{t.Log("host has an ACM device, scanner does not open it")}
}
func TestUSBInventoryMissingSysfsDoesNotPretendEmptyScan(t *testing.T){
 _,err:=scanUSBSerialAt(filepath.Join(t.TempDir(),"missing"))
 if err==nil{t.Fatal("missing sysfs must be an error, not an empty discovery report")}
}
