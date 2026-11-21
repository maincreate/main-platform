package main

// Official Espressif Installation Manager CLI, pinned per Linux architecture.
// This is a fixed-operation adapter, not a remote shell. The only parameter
// accepted by the Host Service is one of two explicitly approved IDF versions.
import (
 "archive/zip"
 "bytes"
 "context"
 "crypto/sha256"
 "encoding/binary"
 "encoding/hex"
 "errors"
 "fmt"
 "io"
 "net/http"
 "os"
 "os/exec"
 "path/filepath"
 "regexp"
 "runtime"
 "strings"
 "syscall"
 "time"
)

const eimVersion="0.21.1"
const maxEIMArchive=int64(48<<20)
const maxEIMExecutable=int64(48<<20)
const eimInstallRoot="/opt/maincreate/toolkits/eim"
const espInstallRoot="/opt/maincreate/toolkits/esp-idf"

type eimRelease struct {asset,sha256,arch string; machine uint16}
func eimReleaseFor(goarch string)(eimRelease,error){
 switch goarch{
 case "amd64":return eimRelease{
  "eim-cli-linux-x64-v0.21.1.zip","87a1d17c0208fe402269d39f471d862525ca902045b1a97f8af99902342fea8b","x64",62},nil
 case "arm64":return eimRelease{
  "eim-cli-linux-aarch64-v0.21.1.zip","dbb7db88869b985404757270c4b7e3a62a701759e0c224722a8cfa2414d08180","arm64",183},nil
 default:return eimRelease{},errors.New("EIM supports Linux x64 and ARM64 only")
 }
}
func eimBinaryPath(goarch string)string{
 r,e:=eimReleaseFor(goarch);if e!=nil{return ""}
 return filepath.Join(eimInstallRoot,eimVersion,"linux-"+r.arch,"eim")
}
func espRuntimeHome()string{return filepath.Join(dataDir,"sdk-runtime","esp-idf")}
func espVersionSupported(v string)bool{return v=="5.5.6"||v=="6.1.1"}
func espVersionPath(v string)string{
 if !espVersionSupported(v){return ""}
 return filepath.Join(espInstallRoot,v)
}
func eimEnv(home string)[]string{
 return append(os.Environ(),
  "HOME="+home,"XDG_CONFIG_HOME="+filepath.Join(home,".config"),
  "TMPDIR="+filepath.Join(home,"tmp"),
  "EIM_DO_NOT_TRACK=1","GIT_TERMINAL_PROMPT=0","PIP_NO_INPUT=1",
  "DEBIAN_FRONTEND=noninteractive")
}
func prepareEIMHome(home string)error{
 for _,p:=range []string{home,filepath.Join(home,".config"),filepath.Join(home,"tmp")}{
  if err:=os.MkdirAll(p,0700);err!=nil{return err}
 }
 return nil
}
func checkEIMVersion(binaryPath string)error{
 if _,err:=os.Stat(binaryPath);err!=nil{return err}
 home:=espRuntimeHome();if err:=prepareEIMHome(home);err!=nil{return err}
 ctx,cancel:=context.WithTimeout(context.Background(),20*time.Second);defer cancel()
 cmd:=exec.CommandContext(ctx,binaryPath,"--version");cmd.Env=eimEnv(home)
 out,err:=cmd.CombinedOutput()
 if err!=nil{return fmt.Errorf("EIM version verification failed: %w",err)}
 if !regexp.MustCompile(`\b0\.21\.1\b`).Match(out){
  return fmt.Errorf("unexpected EIM release: %q",string(out[:min(len(out),200)]))
 }
 return nil
}
func downloadPinnedEIM(ctx context.Context,client *http.Client,r eimRelease)([]byte,error){
 url:="https://github.com/espressif/idf-im-ui/releases/download/v"+eimVersion+"/"+r.asset
 req,e:=http.NewRequestWithContext(ctx,"GET",url,nil);if e!=nil{return nil,e}
 resp,e:=client.Do(req);if e!=nil{return nil,e};defer resp.Body.Close()
 if resp.StatusCode!=http.StatusOK{return nil,fmt.Errorf("EIM download HTTP %d",resp.StatusCode)}
 data,e:=io.ReadAll(io.LimitReader(resp.Body,maxEIMArchive+1));if e!=nil{return nil,e}
 if int64(len(data))>maxEIMArchive||len(data)<1024{return nil,errors.New("EIM archive exceeds allowed size")}
 sum:=sha256.Sum256(data)
 if hex.EncodeToString(sum[:])!=r.sha256{return nil,errors.New("EIM SHA-256 mismatch")}
 return data,nil
}
func extractPinnedEIM(raw []byte,r eimRelease)([]byte,error){
 reader,err:=zip.NewReader(bytes.NewReader(raw),int64(len(raw)));if err!=nil{return nil,err}
 if len(reader.File)>2000{return nil,errors.New("unexpected EIM archive contents")}
 var exe []byte
 aliasSeen:=false
 for _,file:=range reader.File{
  name:=file.Name
  if filepath.IsAbs(name)||strings.Contains(name,"\\")||
   strings.HasPrefix(name,"../")||strings.Contains(name,"/../")||
   strings.ContainsRune(name,'\x00'){
   return nil,errors.New("EIM archive contains unsafe path")
  }
  // Official EIM 0.21.1 distributes a versioned ELF plus an 'eim' alias
  // symlink to it. Validate the alias but never extract, follow, or create it.
  if file.Mode()&os.ModeSymlink!=0{
   if aliasSeen||name!="eim"||file.UncompressedSize64!=uint64(len("eim_v"+eimVersion)){
    return nil,errors.New("EIM archive contains unexpected symlink")
   }
   aliasSeen=true
   f,e:=file.Open();if e!=nil{return nil,e}
   link,e:=io.ReadAll(io.LimitReader(f,128));f.Close()
   if e!=nil{return nil,e}
   if string(link)!="eim_v"+eimVersion{return nil,errors.New("EIM alias points outside expected executable")}
   continue
  }
  if filepath.Base(name)!="eim_v"+eimVersion{continue}
  if name!="eim_v"+eimVersion||file.FileInfo().IsDir(){
   return nil,errors.New("EIM executable has unexpected archive path")
  }
  if exe!=nil{return nil,errors.New("duplicate EIM executable")}
  if file.UncompressedSize64<1024||file.UncompressedSize64>uint64(maxEIMExecutable){
   return nil,errors.New("EIM executable exceeds allowed size")
  }
  f,e:=file.Open();if e!=nil{return nil,e}
  exe,e=io.ReadAll(io.LimitReader(f,maxEIMExecutable+1));f.Close()
  if e!=nil{return nil,e}
  if uint64(len(exe))!=file.UncompressedSize64{return nil,errors.New("truncated EIM executable")}
 }
 if len(exe)<20||!bytes.Equal(exe[:4],[]byte{0x7f,'E','L','F'})||
  exe[4]!=2||binary.LittleEndian.Uint16(exe[18:20])!=r.machine{
  return nil,errors.New("EIM archive contains no matching Linux architecture executable")
 }
 return exe,nil
}
func installPinnedEIM()(string,error){
 if runtime.GOOS!="linux"{return "",errors.New("EIM installation requires Linux")}
 release,err:=eimReleaseFor(runtime.GOARCH);if err!=nil{return "",err}
 path:=eimBinaryPath(runtime.GOARCH)
 if checkEIMVersion(path)==nil{return path,nil}
 ctx,cancel:=context.WithTimeout(context.Background(),12*time.Minute);defer cancel()
 client:=&http.Client{Timeout:10*time.Minute,CheckRedirect:func(req *http.Request,via []*http.Request)error{
  if len(via)>6||req.URL.Scheme!="https"{return errors.New("unsafe EIM release redirect")}
  host:=strings.ToLower(req.URL.Hostname())
  if host!="github.com"&&host!="release-assets.githubusercontent.com"&&
   host!="objects.githubusercontent.com"{return errors.New("unexpected EIM release host")}
  return nil
 }}
 archive,err:=downloadPinnedEIM(ctx,client,release);if err!=nil{return "",err}
 binaryData,err:=extractPinnedEIM(archive,release);if err!=nil{return "",err}
 if err=os.MkdirAll(filepath.Dir(path),0755);err!=nil{return "",err}
 dir,err:=os.MkdirTemp(filepath.Dir(path),".eim-verify-");if err!=nil{return "",err}
 defer os.RemoveAll(dir)
 candidate:=filepath.Join(dir,"eim")
 if err=os.WriteFile(candidate,binaryData,0755);err!=nil{return "",err}
 if err=checkEIMVersion(candidate);err!=nil{return "",err}
 if err=stageArduinoBinary(path,binaryData);err!=nil{return "",err}
 if err=checkEIMVersion(path);err!=nil{return "",err}
 return path,nil
}
// Remember only the final bytes of verbose installer output in job errors.
type eimTail struct{content []byte}
func (w *eimTail)Write(b []byte)(int,error){
 n:=len(b);w.content=append(w.content,b...)
 if len(w.content)>6000{w.content=append([]byte{},w.content[len(w.content)-6000:]...)}
 return n,nil
}
func runBoundedCommand(ctx context.Context,home,dir,exe string,args ...string)(string,error){
 if err:=prepareEIMHome(home);err!=nil{return "",err}
 cmd:=exec.CommandContext(ctx,exe,args...);cmd.Env=eimEnv(home);cmd.Dir=dir
 cmd.WaitDelay=5*time.Second
 var output eimTail;cmd.Stdout=&output;cmd.Stderr=&output
 err:=cmd.Run();tail:=strings.TrimSpace(string(output.content))
 if err!=nil{
  if ctx.Err()!=nil{return tail,fmt.Errorf("installation command timed out or cancelled: %w; output: %s",ctx.Err(),tail)}
  return tail,fmt.Errorf("installation command failed: %w; output: %s",err,tail)
 }
 return tail,nil
}
func checkESPIdfVersion(eimBinary,version string)error{
 if !espVersionSupported(version){return errors.New("unsupported ESP-IDF version")}
 home:=espRuntimeHome()
 ctx,cancel:=context.WithTimeout(context.Background(),45*time.Second);defer cancel()
 output,err:=runBoundedCommand(ctx,home,home,eimBinary,"--do-not-track","true","run",
  "idf.py --version","v"+version)
 if err!=nil{return err}
 re:=regexp.MustCompile(`(?m)^ESP-IDF v`+regexp.QuoteMeta(version)+`(?:\s|$)`)
 if !re.MatchString(output){return fmt.Errorf("ESP-IDF version not confirmed: %q",output)}
 return nil
}
var espPackages=[]string{
 "git","cmake","ninja-build","flex","bison","gperf","ccache",
 "libffi-dev","libssl-dev","dfu-util","libusb-1.0-0",
 "python3-venv","python3-pip","python3-setuptools","python3-wheel",
 "xz-utils","unzip",
}
func ensureEspPrerequisites(ctx context.Context,home string)error{
 // Linux EIM never installs missing OS prerequisites. Use only the configured
 // Debian repository and a fixed, reviewed package list; no remote script.
 if _,e:=exec.LookPath("apt-get");e!=nil{return errors.New("ESP-IDF requires Debian apt-get")}
 required:=[]string{"git","cmake","ninja","flex","bison","gperf","python3","unzip"}
 missing:=false
 for _,name:=range required{if _,e:=exec.LookPath(name);e!=nil{missing=true}}
 if !missing{
  dir,e:=os.MkdirTemp(home,".python-venv-test-");if e!=nil{return e}
  os.RemoveAll(dir)
  check,cancel:=context.WithTimeout(ctx,25*time.Second)
  _,e=runBoundedCommand(check,home,home,"python3","-m","venv",dir)
  cancel();os.RemoveAll(dir)
  if e==nil{return nil}
 }
 check,cancel:=context.WithTimeout(ctx,8*time.Minute)
 _,e:=runBoundedCommand(check,home,home,"apt-get","update");cancel()
 if e!=nil{return fmt.Errorf("ESP-IDF OS prerequisite refresh: %w",e)}
 install,cancel:=context.WithTimeout(ctx,14*time.Minute)
 args:=append([]string{"install","-y","--no-install-recommends"},espPackages...)
 _,e=runBoundedCommand(install,home,home,"apt-get",args...);cancel()
 if e!=nil{return fmt.Errorf("ESP-IDF OS prerequisites: %w",e)}
 return nil
}
func verifyEspDiskSpace()error{
 if err:=os.MkdirAll(espInstallRoot,0755);err!=nil{return err}
 var stat syscall.Statfs_t
 if err:=syscall.Statfs(espInstallRoot,&stat);err!=nil{return err}
 free:=uint64(stat.Bavail)*uint64(stat.Bsize)
 if free<4*1024*1024*1024{return fmt.Errorf("ESP-IDF needs at least 4 GiB available disk space; found %.1f GiB",float64(free)/1073741824)}
 return nil
}
func installESPIdf(version string)(string,error){
 if runtime.GOOS!="linux"||!espVersionSupported(version){
  return "",errors.New("unsupported managed ESP-IDF release or OS")
 }
 home:=espRuntimeHome()
 if err:=prepareEIMHome(home);err!=nil{return "",err}
 bin,err:=installPinnedEIM();if err!=nil{return "",fmt.Errorf("pinned EIM bootstrap: %w",err)}
 if checkESPIdfVersion(bin,version)==nil{
  return "ESP-IDF v"+version+" already installed and verified using EIM CLI "+eimVersion,nil
 }
 if err=verifyEspDiskSpace();err!=nil{return "",err}
 ctx,cancel:=context.WithTimeout(context.Background(),55*time.Minute);defer cancel()
 if err=ensureEspPrerequisites(ctx,home);err!=nil{return "",err}
 _,err=runBoundedCommand(ctx,home,home,bin,"--do-not-track","true","install",
  "-i","v"+version,"-p",espVersionPath(version),"--cleanup","true",
  "--skip-components-download","true")
 if err!=nil{return "",fmt.Errorf("ESP-IDF v%s installation: %w",version,err)}
 if err=checkESPIdfVersion(bin,version);err!=nil{return "",fmt.Errorf("ESP-IDF v%s post-install verification: %w",version,err)}
 return "ESP-IDF v"+version+" installed, activated, and verified with pinned EIM CLI "+eimVersion,nil
}
