package main

import (
 "archive/tar"
 "bytes"
 "compress/gzip"
 "context"
 "crypto/sha256"
 "encoding/hex"
 "io"
 "net/http"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func makeArduinoArchive(t *testing.T, entries []struct{name string; kind byte; bytes []byte})[]byte{
 t.Helper()
 var body bytes.Buffer
 zip:=gzip.NewWriter(&body);tw:=tar.NewWriter(zip)
 for _,e:=range entries{
  header:=&tar.Header{Name:e.name,Mode:0755,Size:int64(len(e.bytes)),Typeflag:e.kind}
  if e.kind==tar.TypeSymlink{header.Size=0;header.Linkname="../../etc/passwd"}
  if err:=tw.WriteHeader(header);err!=nil{t.Fatal(err)}
  if header.Size>0{if _,err:=tw.Write(e.bytes);err!=nil{t.Fatal(err)}}
 }
 if err:=tw.Close();err!=nil{t.Fatal(err)}
 if err:=zip.Close();err!=nil{t.Fatal(err)}
 return body.Bytes()
}
func dummyELF()[]byte{return append([]byte{0x7f,'E','L','F'},bytes.Repeat([]byte{'x'},2048)...)}
func TestArduinoReleasePinning(t *testing.T){
 for _,arch:=range []string{"amd64","arm64"}{
  r,e:=arduinoReleaseFor(arch)
  if e!=nil{t.Fatal(e)}
  if !strings.HasPrefix(r.asset,"arduino-cli_1.5.1_Linux_"){t.Fatal("wrong pinned version")}
  if len(r.sha256)!=64{t.Fatal("expected SHA-256 pin")}
  if _,e=hex.DecodeString(r.sha256);e!=nil{t.Fatal(e)}
 }
 if _,e:=arduinoReleaseFor("386");e==nil{t.Fatal("unsupported arch accepted")}
}
func TestArduinoExtractionOnlyAllowedExecutable(t *testing.T){
 good:=dummyELF()
 valid:=makeArduinoArchive(t,[]struct{name string;kind byte;bytes []byte}{
  {"arduino-cli",tar.TypeReg,good},
  {"LICENSE.txt",tar.TypeReg,[]byte("text")},
 })
 data,e:=extractArduinoBinary(valid);if e!=nil{t.Fatal(e)}
 if !bytes.Equal(data,good){t.Fatal("binary changed")}
 for _,tc:=range []struct{name string; kind byte; bytes []byte}{
  {"../arduino-cli",tar.TypeReg,good},
  {"/arduino-cli",tar.TypeReg,good},
  {"folder/../../arduino-cli",tar.TypeReg,good},
  {"arduino-cli",tar.TypeSymlink,nil},
  {"arduino-cli",tar.TypeReg,[]byte("not executable")},
 }{
  archive:=makeArduinoArchive(t,[]struct{name string;kind byte;bytes []byte}{tc})
  if _,err:=extractArduinoBinary(archive);err==nil{t.Fatalf("accepted unsafe archive %q",tc.name)}
 }
 duplicate:=makeArduinoArchive(t,[]struct{name string;kind byte;bytes []byte}{
  {"arduino-cli",tar.TypeReg,good},{"sub/arduino-cli",tar.TypeReg,good},
 })
 if _,e:=extractArduinoBinary(duplicate);e==nil{t.Fatal("duplicate executable accepted")}
}
func TestArduinoArchiveHashRejectsTampering(t *testing.T){
 bytes:=bytes.Repeat([]byte("untrusted firmware"),100)
 client:=&http.Client{Transport:roundTripFunc(func(req *http.Request)(*http.Response,error){
  if req.URL.Host!="github.com"{t.Errorf("unexpected initial source host")}
  return &http.Response{StatusCode:200,Body:io.NopCloser(strings.NewReader(string(bytes))),
   Header:make(http.Header),Request:req},nil
 })}
 release,e:=arduinoReleaseFor("amd64");if e!=nil{t.Fatal(e)}
 _,e=fetchArduinoRelease(context.Background(),client,release)
 if e==nil||!strings.Contains(e.Error(),"SHA-256 mismatch"){
  t.Fatalf("tampered archive accepted: %v",e)
 }
}
func TestArduinoVersionedInstallPath(t *testing.T){
 for _,arch:=range []string{"amd64","arm64"}{
  path:=arduinoBinaryPath(arch)
  if !strings.Contains(path,arduinoCLIVersion)||!strings.HasPrefix(path,"/opt/maincreate/toolkits/"){
   t.Fatal("installed toolkit not in managed public toolkit root")
  }
 }
 if arduinoBinaryPath("386")!=""{t.Fatal("unsupported arch has install path")}
 target:=filepath.Join(t.TempDir(),"arduino-cli")
 if e:=stageArduinoBinary(target,dummyELF());e!=nil{t.Fatal(e)}
 observed,e:=os.ReadFile(target);if e!=nil{t.Fatal(e)}
 if !bytes.Equal(observed,dummyELF()){t.Fatal("staged contents differ")}
 stat,e:=os.Stat(target);if e!=nil{t.Fatal(e)}
 if stat.Mode().Perm()!=0755{t.Fatalf("binary not executable: %v",stat.Mode())}
 sum:=sha256.Sum256(observed)
 if hex.EncodeToString(sum[:])==""{t.Fatal("invalid digest")}
}
type roundTripFunc func(*http.Request)(*http.Response,error)
func (r roundTripFunc)RoundTrip(req *http.Request)(*http.Response,error){return r(req)}

func TestArduinoVersionOutputFormats(t *testing.T){
 for _,tc:=range []struct{output string;want bool}{
  {"arduino-cli 1.5.1 Commit: 0123456 Date: 2026-10-01",true},
  {"arduino-cli Version: 1.5.1 Commit: abc123",true},
  {"arduino-cli  Version: v1.5.1",true},
  {"arduino-cli Version: 1.5.0",false},
  {"Arduino CLI Version: 1.5.1",false},
  {"arduino-cli 1.5.11",false},
  {"not-arduino 1.5.1",false},
 }{
  if observed:=arduinoVersionOutputMatches(tc.output);observed!=tc.want{
   t.Fatalf("version output %q accepted=%t, want %t",tc.output,observed,tc.want)
  }
 }
}
