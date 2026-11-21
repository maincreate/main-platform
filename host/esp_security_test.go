package main
import ("strings";"testing")

func TestSecurityPreflightRejectsInvalidJobAndSerial(t *testing.T){
 _,err:=esp32SecurityPreflight(config{},"../invalid","/dev/ttyACM0","44:bd:8d:78:15:e8")
 if err==nil||!strings.Contains(err.Error(),"job ID"){t.Fatalf("invalid job accepted: %v",err)}
 for _,port:=range []string{"","/dev/ttyS0","/dev/ttyACM0 --unsafe","/tmp/ttyACM0"}{
  _,err:=esp32SecurityPreflight(config{},"0123456789abcdef0123456789abcdef",port,"44:bd:8d:78:15:e8")
  if err==nil||!strings.Contains(err.Error(),"canonical"){t.Fatalf("unsafe port %q: %v",port,err)}
 }
}
func TestSecurityReportCannotApproveFlashing(t *testing.T){
 report:=esp32SecurityReport{Schema:1,Chip:"ESP32-S3",MAC:"44:bd:8d:78:15:e8",
  RawSecurityInfo:"Security Information",SecurityVerified:false,FlashAllowed:false}
 if report.SecurityVerified||report.FlashAllowed{t.Fatal("security evidence alone cannot approve a firmware write")}
}
