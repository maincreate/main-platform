package main

// Read-only Linux USB serial discovery for the managed Host Service.
// Never opens /dev/tty* and never probes flash memory.
import (
 "fmt"
 "os"
 "path/filepath"
 "sort"
 "strconv"
 "strings"
)

type usbDevice struct {
 Port string `json:"port"`
 Description string `json:"description"`
 Manufacturer string `json:"manufacturer,omitempty"`
 Product string `json:"product,omitempty"`
 VID int `json:"vid"`
 PID int `json:"pid"`
 SerialNumber string `json:"serialNumber,omitempty"`
 Location string `json:"location,omitempty"`
 Interface string `json:"interface,omitempty"`
}
func readAttribute(dir,name string)string{
 bytes,err:=os.ReadFile(filepath.Join(dir,name));if err!=nil{return ""}
 val:=strings.TrimSpace(string(bytes))
 if len(val)>120{return ""}
 for _,ch:=range val{if ch<32||ch==127{return ""}}
 return val
}
func usbAncestor(path string)(string,bool){
 for n:=0;n<9;n++{
  if readAttribute(path,"idVendor")!=""&&readAttribute(path,"idProduct")!=""{return path,true}
  next:=filepath.Dir(path)
  if next==path{break}
  path=next
 }
 return "",false
}
func scanUSBSerialAt(root string)([]usbDevice,error){
 entries,err:=os.ReadDir(root);if err!=nil{return nil,fmt.Errorf("USB inventory sysfs unavailable: %w",err)}
 var devices []usbDevice
 for _,entry:=range entries{
  name:=entry.Name()
  if !strings.HasPrefix(name,"ttyACM")&&!strings.HasPrefix(name,"ttyUSB"){continue}
  for _,ch:=range strings.TrimPrefix(strings.TrimPrefix(name,"ttyACM"),"ttyUSB"){
   if ch<'0'||ch>'9'{name="";break}
  }
  if name==""{continue}
  link,err:=filepath.EvalSymlinks(filepath.Join(root,name,"device"));if err!=nil{continue}
  usb,ok:=usbAncestor(link);if !ok{continue}
  v,ve:=strconv.ParseUint(readAttribute(usb,"idVendor"),16,16)
  p,pe:=strconv.ParseUint(readAttribute(usb,"idProduct"),16,16)
  if ve!=nil||pe!=nil{continue}
  product:=readAttribute(usb,"product")
  desc:=product;if desc==""{desc="USB serial device"}
  location:=filepath.Base(usb)
  devices=append(devices,usbDevice{
   Port:"/dev/"+name,Description:desc,Manufacturer:readAttribute(usb,"manufacturer"),
   Product:product,VID:int(v),PID:int(p),SerialNumber:readAttribute(usb,"serial"),
   Location:location,
  })
  if len(devices)>=48{break}
 }
 sort.Slice(devices,func(i,j int)bool{return devices[i].Port<devices[j].Port})
 return devices,nil
}
func scanUSBSerial()([]usbDevice,error){return scanUSBSerialAt("/sys/class/tty")}
