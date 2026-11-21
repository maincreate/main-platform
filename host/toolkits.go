package main

// Native, fixed-operation SDK installation for managed Linux hosts.
// The server controls which typed capability is scheduled; this adapter has
// no user-supplied URL, shell command, path, or installer arguments.
import (
 "archive/tar"
 "bytes"
 "compress/gzip"
 "context"
 "crypto/sha256"
 "encoding/hex"
 "errors"
 "fmt"
 "io"
 "net/http"
 "os"
 "os/exec"
 "path/filepath"
 "runtime"
 "regexp"
 "strings"
 "time"
)

const arduinoCLIVersion="1.5.1"
const maxArduinoArchive=int64(64<<20)
const maxArduinoBinary=int64(48<<20)
const arduinoRoot="/opt/maincreate/toolkits/arduino-cli"

type arduinoRelease struct {asset string; sha256 string; arch string}
func arduinoReleaseFor(goarch string)(arduinoRelease,error){
 switch goarch {
 case "amd64":
  return arduinoRelease{"arduino-cli_1.5.1_Linux_64bit.tar.gz",
   "28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b","x64"},nil
 case "arm64":
  return arduinoRelease{"arduino-cli_1.5.1_Linux_ARM64.tar.gz",
   "1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62","arm64"},nil
 default:return arduinoRelease{},errors.New("Arduino CLI supports Linux ARM64 and x64 only")
 }
}
func arduinoBinaryPath(goarch string)string{
 release,err:=arduinoReleaseFor(goarch)
 if err!=nil{return ""}
 return filepath.Join(arduinoRoot,arduinoCLIVersion,"linux-"+release.arch,"arduino-cli")
}
var arduinoVersionPattern=regexp.MustCompile(`(?i)\barduino-cli\s+(?:version:\s*)?v?1\.5\.1(?:\s|$)`)
func arduinoVersionOutputMatches(output string)bool{
 return arduinoVersionPattern.MatchString(strings.TrimSpace(output))
}
func checkArduinoVersion(binary string)error{
 return checkArduinoVersionInHome(binary,filepath.Join(dataDir,"sdk-runtime","arduino-cli"))
}
func checkArduinoVersionInHome(binary,home string)error{
 // ProtectHome=yes on the managed systemd service intentionally hides /root.
 // Give the official CLI a dedicated writable and private state directory.
 if err:=os.MkdirAll(home,0700);err!=nil{return fmt.Errorf("Arduino CLI runtime directory: %w",err)}
 ctx,cancel:=context.WithTimeout(context.Background(),15*time.Second);defer cancel()
 cmd:=exec.CommandContext(ctx,binary,"version")
 cmd.Env=append(os.Environ(),"HOME="+home,"XDG_CONFIG_HOME="+filepath.Join(home,".config"))
 output,err:=cmd.CombinedOutput()
 sample:=strings.TrimSpace(string(output))
 if len(sample)>500{sample=sample[:500]}
 if err!=nil{return fmt.Errorf("Arduino CLI version command failed (%s): %w",sample,err)}
 if !arduinoVersionOutputMatches(string(output)){
  return fmt.Errorf("unexpected Arduino CLI version output: %q",sample)
 }
 return nil
}
func arduinoVersionOK(binary string)bool{return checkArduinoVersion(binary)==nil}
func fetchArduinoRelease(ctx context.Context,client *http.Client,release arduinoRelease)([]byte,error){
 url:="https://github.com/arduino/arduino-cli/releases/download/v"+
  arduinoCLIVersion+"/"+release.asset
 req,err:=http.NewRequestWithContext(ctx,"GET",url,nil);if err!=nil{return nil,err}
 res,err:=client.Do(req);if err!=nil{return nil,err};defer res.Body.Close()
 if res.StatusCode!=http.StatusOK{return nil,fmt.Errorf("Arduino release HTTP %d",res.StatusCode)}
 archive,err:=io.ReadAll(io.LimitReader(res.Body,maxArduinoArchive+1))
 if err!=nil{return nil,err}
 if len(archive)<1024||int64(len(archive))>maxArduinoArchive{
  return nil,errors.New("Arduino release archive outside allowed size")
 }
 digest:=sha256.Sum256(archive)
 if hex.EncodeToString(digest[:])!=release.sha256{
  return nil,errors.New("Arduino release SHA-256 mismatch")
 }
 return archive,nil
}
func extractArduinoBinary(archive []byte)([]byte,error){
 g,err:=gzip.NewReader(bytes.NewReader(archive));if err!=nil{return nil,err}
 defer g.Close()
 t:=tar.NewReader(g)
 var binary []byte
 for count:=0;count<2000;count++{
  header,e:=t.Next()
  if e==io.EOF{break}
  if e!=nil{return nil,e}
  name:=header.Name
  if filepath.IsAbs(name)||strings.Contains(name,"\\")||
   strings.HasPrefix(name,"../")||strings.Contains(name,"/../")||
   name==".."||strings.ContainsRune(name,'\x00'){
   return nil,errors.New("Arduino archive contains unsafe path")
  }
  if header.Typeflag==tar.TypeSymlink||header.Typeflag==tar.TypeLink{
   return nil,errors.New("Arduino archive contains link")
  }
  if filepath.Base(name)!="arduino-cli"||header.Typeflag!=tar.TypeReg{continue}
  if binary!=nil{return nil,errors.New("duplicate Arduino executable")}
  if header.Size<1024||header.Size>maxArduinoBinary{
   return nil,errors.New("Arduino executable outside allowed size")
  }
  binary,e=io.ReadAll(io.LimitReader(t,maxArduinoBinary+1))
  if e!=nil{return nil,e}
  if int64(len(binary))!=header.Size{return nil,errors.New("truncated Arduino executable")}
 }
 if len(binary)==0{return nil,errors.New("Arduino executable missing from release")}
 if len(binary)<4||!bytes.Equal(binary[:4],[]byte{0x7f,'E','L','F'}){
  return nil,errors.New("Arduino executable is not a Linux ELF binary")
 }
 return binary,nil
}
// The Host Service runs as root, so installed SDK executables are placed in a
// readable system toolkit directory, not inside private /var/lib/maincreate.
func stageArduinoBinary(dest string,binary []byte)error{
 dir:=filepath.Dir(dest)
 if err:=os.MkdirAll(dir,0755);err!=nil{return err}
 file,err:=os.CreateTemp(dir,".arduino-cli-*")
 if err!=nil{return err}
 defer os.Remove(file.Name())
 if err=file.Chmod(0755);err!=nil{file.Close();return err}
 if _,err=file.Write(binary);err!=nil{file.Close();return err}
 if err=file.Sync();err!=nil{file.Close();return err}
 if err=file.Close();err!=nil{return err}
 if err=os.Rename(file.Name(),dest);err!=nil{return err}
 return nil
}
func installArduinoCLI() (string,error){
 if runtime.GOOS!="linux"{return "",errors.New("Arduino CLI install requires Linux")}
 target,err:=arduinoReleaseFor(runtime.GOARCH);if err!=nil{return "",err}
 dest:=arduinoBinaryPath(runtime.GOARCH)
 if arduinoVersionOK(dest){return "Arduino CLI 1.5.1 already installed and verified",nil}
 ctx,cancel:=context.WithTimeout(context.Background(),12*time.Minute);defer cancel()
 client:=&http.Client{Timeout:10*time.Minute,CheckRedirect:func(req *http.Request,via []*http.Request)error{
  if len(via)>6||req.URL.Scheme!="https"{return errors.New("unsafe Arduino release redirect")}
  h:=strings.ToLower(req.URL.Hostname())
  if h!="github.com"&&h!="objects.githubusercontent.com"&&
    h!="release-assets.githubusercontent.com"{return errors.New("unexpected Arduino release host")}
  return nil
 }}
 archive,err:=fetchArduinoRelease(ctx,client,target);if err!=nil{return "",err}
 binary,err:=extractArduinoBinary(archive);if err!=nil{return "",err}
 // Verify from the executable's actual destination filesystem. In particular,
 // the system's /tmp may be mounted noexec, so never execute candidates there.
 if err=os.MkdirAll(filepath.Dir(dest),0755);err!=nil{return "",err}
 tmpDir,err:=os.MkdirTemp(filepath.Dir(dest),".arduino-verify-")
 if err!=nil{return "",err}
 defer os.RemoveAll(tmpDir)
 candidate:=filepath.Join(tmpDir,"arduino-cli")
 if err=os.WriteFile(candidate,binary,0755);err!=nil{return "",err}
 if err=checkArduinoVersion(candidate);err!=nil{return "",err}
 if err=stageArduinoBinary(dest,binary);err!=nil{return "",err}
 if err=checkArduinoVersion(dest);err!=nil{return "",err}
 return "Arduino CLI 1.5.1 installed and verified on Linux "+target.arch,nil
}
