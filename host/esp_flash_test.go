package main

import (
 "bytes"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
)

func TestFlashSecurityFailsClosed(t *testing.T){
 good:="Security Information:\nFlags: 0x00000000 (0b0)\nSecure Boot: Disabled\nFlash Encryption: Disabled\nSPI Boot Crypt Count (SPI_BOOT_CRYPT_CNT): 0x0\n"
 if err:=flashSecurityAllowsPlaintext(good);err!=nil{t.Fatal(err)}
 for _,bad:=range []string{
  strings.Replace(good,"Secure Boot: Disabled","Secure Boot: Enabled",1),
  strings.Replace(good,"Flash Encryption: Disabled","Flash Encryption: Enabled",1),
  strings.Replace(good,"Flags: 0x00000000","Flags: 0x00000001",1),
  "Status unknown\n",
 }{
  if err:=flashSecurityAllowsPlaintext(bad);err==nil{t.Fatal("accepted unknown or enabled protection")}
 }
}

func TestFlashImageOffsetsDoNotOverlap(t *testing.T){
 images:=map[string][]byte{
  "esp32s3-bootloader.bin":bytes.Repeat([]byte{1},20464),
  "esp32s3-partitions.bin":bytes.Repeat([]byte{2},3072),
  "esp32s3-firmware.bin":bytes.Repeat([]byte{3},191648),
 }
 if err:=verifyFlashImageLayout(images);err!=nil{t.Fatal(err)}
 images["esp32s3-bootloader.bin"]=make([]byte,0x8001)
 if err:=verifyFlashImageLayout(images);err==nil{t.Fatal("overlapping bootloader")}
 delete(images,"esp32s3-firmware.bin")
 if err:=verifyFlashImageLayout(images);err==nil{t.Fatal("missing firmware")}
}

func TestControllerEvidenceReceiptIsMandatory(t *testing.T){
 server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  var req map[string]any
  _=json.NewDecoder(r.Body).Decode(&req)
  if req["action"]!="flash_preflight"||req["expected_mac"]!="44:bd:8d:78:15:e8"{
   t.Errorf("unexpected receipt request: %v",req)
  }
  _=json.NewEncoder(w).Encode(map[string]any{"authorized":false})
 }))
 defer server.Close()
 c:=config{Controller:server.URL,ID:"runner",Token:"secret"}
 if err:=verifyControllerFlashEvidence(c,
  strings.Repeat("1",32),strings.Repeat("2",32),strings.Repeat("3",32),
  "/dev/ttyACM0","44:bd:8d:78:15:e8");err==nil{
  t.Fatal("accepted missing verified recovery receipt")
 }
}
