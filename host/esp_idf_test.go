package main

import (
 "archive/zip"
 "bytes"
 "context"
 "crypto/sha256"
 "encoding/binary"
 "encoding/hex"
 "io"
 "net/http"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"
)

func fakeEIMElf(machine uint16)[]byte{
 raw:=make([]byte,4096);copy(raw,[]byte{0x7f,'E','L','F'})
 raw[4]=2;raw[5]=1;binary.LittleEndian.PutUint16(raw[18:20],machine)
 return raw
}
func testEIMZip(t *testing.T,files []struct{name string; data []byte; mode os.FileMode})[]byte{
 t.Helper()
 var buffer bytes.Buffer
 w:=zip.NewWriter(&buffer)
 for _,part:=range files{
  header:=&zip.FileHeader{Name:part.name,Method:zip.Deflate}
  header.SetMode(part.mode)
  f,err:=w.CreateHeader(header);if err!=nil{t.Fatal(err)}
  if _,err=f.Write(part.data);err!=nil{t.Fatal(err)}
 }
 if err:=w.Close();err!=nil{t.Fatal(err)}
 return buffer.Bytes()
}
func TestEIMReleasePinsAndArchitecture(t *testing.T){
 for _,tc:=range []struct{arch,expected string;machine uint16}{
  {"amd64","x64",62},{"arm64","arm64",183},
 }{
  r,err:=eimReleaseFor(tc.arch);if err!=nil{t.Fatal(err)}
  if r.arch!=tc.expected||r.machine!=tc.machine{t.Fatal("wrong architecture release")}
  if !strings.HasSuffix(r.asset,"-v0.21.1.zip"){t.Fatal("EIM release not pinned")}
  if _,err=hex.DecodeString(r.sha256);err!=nil{t.Fatal(err)}
  if len(r.sha256)!=64{t.Fatal("missing SHA-256 pin")}
  if !strings.Contains(eimBinaryPath(tc.arch),"0.21.1"){t.Fatal("install path not versioned")}
  // Exact official archive layout: a versioned executable and a harmless
  // alias symlink. The extractor validates but does not materialize the alias.
  official:=testEIMZip(t,[]struct{name string;data []byte;mode os.FileMode}{
   {"eim_v0.21.1",fakeEIMElf(tc.machine),0755},
   {"eim",[]byte("eim_v0.21.1"),os.ModeSymlink|0755},
  })
  exe,err:=extractPinnedEIM(official,r)
  if err!=nil{t.Fatal(err)}
  if len(exe)!=4096{t.Fatal("executable changed")}
  invalid:=testEIMZip(t,[]struct{name string;data []byte;mode os.FileMode}{
   {"eim_v0.21.1",fakeEIMElf(1),0755},
  })
  if _,err=extractPinnedEIM(invalid,r);err==nil{t.Fatal("wrong ELF architecture accepted")}
 }
 if _,err:=eimReleaseFor("386");err==nil{t.Fatal("unsupported architecture accepted")}
 if eimBinaryPath("386")!=""{t.Fatal("unsupported binary destination accepted")}
}
func TestEIMArchiveRejectsUnsafeEntries(t *testing.T){
 r,_:=eimReleaseFor("amd64")
 for _,v:=range []struct{name string;mode os.FileMode;data []byte}{
  {"../eim_v0.21.1",0755,fakeEIMElf(r.machine)},
  {"/eim_v0.21.1",0755,fakeEIMElf(r.machine)},
  {"sub/../../eim_v0.21.1",0755,fakeEIMElf(r.machine)},
  {"sub/eim_v0.21.1",0755,fakeEIMElf(r.machine)},
  {"eim_v0.21.1",os.ModeSymlink|0755,[]byte("eim_v0.21.1")},
  {"eim",os.ModeSymlink|0755,[]byte("../etc/shadow")},
  {"other-symlink",os.ModeSymlink|0755,[]byte("eim_v0.21.1")},
 }{
  archive:=testEIMZip(t,[]struct{name string;data []byte;mode os.FileMode}{
   {v.name,v.data,v.mode},
  })
  if _,err:=extractPinnedEIM(archive,r);err==nil{t.Fatalf("accepted unsafe %q",v.name)}
 }
 duplicate:=testEIMZip(t,[]struct{name string;data []byte;mode os.FileMode}{
  {"eim_v0.21.1",fakeEIMElf(r.machine),0755},
  {"eim_v0.21.1",fakeEIMElf(r.machine),0755},
 })
 if _,err:=extractPinnedEIM(duplicate,r);err==nil{t.Fatal("duplicate installer executable accepted")}
}
func TestEIMDownloadRejectsWrongDigest(t *testing.T){
 r,_:=eimReleaseFor("amd64")
 data:=bytes.Repeat([]byte("malicious archive payload"),150)
 client:=&http.Client{Transport:roundTripFunc(func(req *http.Request)(*http.Response,error){
  if req.URL.Host!="github.com"{t.Errorf("unexpected official source: %v",req.URL)}
  return &http.Response{StatusCode:200,Body:io.NopCloser(bytes.NewReader(data)),
   Header:make(http.Header),Request:req},nil
 })}
 _,err:=downloadPinnedEIM(context.Background(),client,r)
 if err==nil||!strings.Contains(err.Error(),"SHA-256 mismatch"){t.Fatalf("tampered EIM accepted: %v",err)}
 h:=sha256.Sum256(data);if hex.EncodeToString(h[:])==r.sha256{t.Fatal("test data matches official release")}
}
func TestESPVersionSelectionOnlyCatalogedValues(t *testing.T){
 for _,version:=range []string{"5.5.6","6.1.1"}{
  if !espVersionSupported(version)||!strings.HasSuffix(espVersionPath(version),version){
   t.Fatalf("cataloged version %q rejected",version)
  }
 }
 for _,version:=range []string{"","latest","5.5","6.4","../etc","5.5.6;rm -rf /"}{
  if espVersionSupported(version)||espVersionPath(version)!=""{t.Fatalf("unsafe release accepted: %q",version)}
 }
}
func TestEIMExecutionUsesPrivateRuntimeHomeAndBoundedOutput(t *testing.T){
 home:=t.TempDir()
 script:=filepath.Join(home,"probe")
 contents:="#!/bin/sh\nmkdir -p \"$HOME/.espressif\" || exit 9\nprintf 'AAAAAAAAAAAAAAAAAAAAAAAAAAA\\n'\n"
 if err:=os.WriteFile(script,[]byte(contents),0755);err!=nil{t.Fatal(err)}
 ctx,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel()
 result,err:=runBoundedCommand(ctx,home,home,script)
 if err!=nil{t.Fatal(err)}
 if !strings.Contains(result,"AAAA"){t.Fatal("tool output missing")}
 if _,err=os.Stat(filepath.Join(home,".espressif"));err!=nil{t.Fatal("private EIM HOME not honored")}
 stat,err:=os.Stat(filepath.Join(home,"tmp"));if err!=nil{t.Fatal(err)}
 if stat.Mode().Perm()!=0700{t.Fatalf("private runtime directory permissions: %v",stat.Mode())}
}
