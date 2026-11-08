package main

import (
 "archive/tar"
 "bytes"
 "compress/gzip"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "net/http"
 "os"
 "os/exec"
 "path/filepath"
 "runtime"
 "strings"
 "time"
)

const runnerDir="/opt/tinkertunnel/actions-runner"
// The official runner bundle can contain files exceeding 100 MiB (for example bundled runtimes).
// Keep separate limits on each member and on total expanded bytes.
const maxRunnerMemberBytes int64 = 512 << 20
const maxRunnerExpandedBytes int64 = 800 << 20
type release struct{
 TagName string `json:"tag_name"`
 Assets []struct{Name string `json:"name"`;Digest string `json:"digest"`;BrowserDownloadURL string `json:"browser_download_url"`} `json:"assets"`
}
func runCmd(user,dir,bin string,args ...string)error{
 var cmd *exec.Cmd
 if user!=""{all:=append([]string{"-u",user,"--",bin},args...);cmd=exec.Command("runuser",all...)}else{cmd=exec.Command(bin,args...)}
 cmd.Dir=dir;cmd.Stdout=io.Discard
 var stderr bytes.Buffer;cmd.Stderr=&stderr
 if e:=cmd.Run();e!=nil{return fmt.Errorf("%s failed: %s: %w",filepath.Base(bin),strings.TrimSpace(stderr.String()),e)}
 return nil
}
func downloadRunner()([]byte,error){
 if runtime.GOOS!="linux"||runtime.GOARCH!="arm64"{return nil,errors.New("only Linux ARM64 supported in this release")}
 req,e:=http.NewRequest("GET","https://api.github.com/repos/actions/runner/releases/latest",nil);if e!=nil{return nil,e}
 req.Header.Set("User-Agent","TinkerTunnel-Host/"+version)
 res,e:=httpClient.Do(req);if e!=nil{return nil,e};defer res.Body.Close()
 if res.StatusCode!=200{return nil,fmt.Errorf("GitHub release API HTTP %d",res.StatusCode)}
 var r release;if e=json.NewDecoder(io.LimitReader(res.Body,1<<20)).Decode(&r);e!=nil{return nil,e}
 name:="actions-runner-linux-arm64-"+strings.TrimPrefix(r.TagName,"v")+".tar.gz"
 for _,a:=range r.Assets{
  if a.Name!=name{continue}
  if !strings.HasPrefix(a.Digest,"sha256:")||len(a.Digest)!=71{return nil,errors.New("runner release missing sha256 digest")}
  if !strings.HasPrefix(a.BrowserDownloadURL,"https://github.com/actions/runner/releases/download/"){return nil,errors.New("unexpected GitHub runner asset URL")}
  client:=&http.Client{Timeout:10*time.Minute}
  resp,e:=client.Get(a.BrowserDownloadURL);if e!=nil{return nil,e};defer resp.Body.Close()
  if resp.StatusCode!=200{return nil,fmt.Errorf("runner archive HTTP %d",resp.StatusCode)}
  body,e:=io.ReadAll(io.LimitReader(resp.Body,(256<<20)+1));if e!=nil{return nil,e}
  if len(body)>256<<20{return nil,errors.New("runner archive too large")}
  hash:=sha256.Sum256(body)
  if !strings.EqualFold(hex.EncodeToString(hash[:]),strings.TrimPrefix(a.Digest,"sha256:")){return nil,errors.New("runner checksum mismatch")}
  return body,nil
 }
 return nil,errors.New("no verified Linux ARM64 runner in latest release")
}
func countRunnerMember(total,size int64)(int64,error){
 if size<0||size>maxRunnerMemberBytes{return total,errors.New("runner archive member too large")}
 if total<0||total>maxRunnerExpandedBytes||size>maxRunnerExpandedBytes-total{return total,errors.New("runner archive expands too large")}
 return total+size,nil
}
func unpackVerified(archive []byte,dir string)error{
 gz,e:=gzip.NewReader(bytes.NewReader(archive));if e!=nil{return e};defer gz.Close()
 tr:=tar.NewReader(gz);var total int64
 for{
  h,e:=tr.Next();if e==io.EOF{break};if e!=nil{return e}
  p:=filepath.Clean(h.Name);if p=="."{continue}
  if filepath.IsAbs(p)||p==".."||strings.HasPrefix(p,"../"){return errors.New("unsafe runner archive path")}
  dest:=filepath.Join(dir,p)
  if h.Typeflag==tar.TypeDir{if e=os.MkdirAll(dest,0755);e!=nil{return e};continue}
  if h.Typeflag==tar.TypeSymlink{
   target:=filepath.Clean(filepath.Join(filepath.Dir(dest),h.Linkname))
   relative,err:=filepath.Rel(dir,target)
   if err!=nil||relative==".."||strings.HasPrefix(relative,".."+string(filepath.Separator)){return errors.New("unsafe archive symlink")}
   if e=os.MkdirAll(filepath.Dir(dest),0755);e!=nil{return e}
   if e=os.Symlink(h.Linkname,dest);e!=nil{return e};continue
  }
  if h.Typeflag!=tar.TypeReg&&h.Typeflag!=tar.TypeRegA{return errors.New("unsupported archive entry type")}
  total,e=countRunnerMember(total,h.Size);if e!=nil{return e}
  if e=os.MkdirAll(filepath.Dir(dest),0755);e!=nil{return e}
  mode:=os.FileMode(0644);if h.Mode&0111!=0{mode=0755}
  f,e:=os.OpenFile(dest,os.O_CREATE|os.O_WRONLY|os.O_EXCL,mode);if e!=nil{return e}
  _,copyErr:=io.CopyN(f,tr,h.Size);closeErr:=f.Close()
  if copyErr!=nil{return copyErr};if closeErr!=nil{return closeErr}
 }
 return nil
}
// Never discard an existing installation. Older installers could leave a partial
// extraction behind; preserve it in a named backup before a clean retry.
func prepareRunnerTarget(dir string)error{
 info,e:=os.Lstat(dir)
 if errors.Is(e,os.ErrNotExist){return nil}
 if e!=nil{return e}
 if !info.IsDir(){return errors.New("runner installation target is not a directory")}
 if _,e=os.Lstat(filepath.Join(dir,".runner"));e==nil{return errors.New("runner already registered; refusing replacement")}else if !errors.Is(e,os.ErrNotExist){return e}
 files,e:=os.ReadDir(dir);if e!=nil{return e}
 if len(files)==0{return os.Remove(dir)}
 backup:=fmt.Sprintf("%s.incomplete-%d",dir,time.Now().UTC().UnixNano())
 if e=os.Rename(dir,backup);e!=nil{return fmt.Errorf("cannot preserve incomplete runner installation: %w",e)}
 return nil
}
func provisionRunner(a action)error{
 if os.Geteuid()!=0{return errors.New("root required for runner provisioning")}
 if _,e:=os.Lstat(filepath.Join(runnerDir,".runner"));e==nil{return errors.New("runner already registered; refusing replacement")}
 archive,e:=downloadRunner();if e!=nil{return e}
 parent:=filepath.Dir(runnerDir)
 if e=os.MkdirAll(parent,0755);e!=nil{return e}
 stage,e:=os.MkdirTemp(parent,".actions-runner-stage-");if e!=nil{return e}
 defer os.RemoveAll(stage)
 if e=unpackVerified(archive,stage);e!=nil{return e}
 if e=prepareRunnerTarget(runnerDir);e!=nil{return e}
 if e=os.Rename(stage,runnerDir);e!=nil{return e}
 if e=runCmd("",runnerDir,"chown","-R","tt-runner:tt-runner",runnerDir);e!=nil{return e}
 args:=[]string{"--unattended","--url","https://github.com/"+a.Organization,"--token",a.RegistrationToken,"--name",a.RunnerName,"--labels",strings.Join(a.Labels,","),"--work","_work"}
 // Only the official runner config process sees the short-lived registration token.
 if e=runCmd("tt-runner",runnerDir,"./config.sh",args...);e!=nil{return e}
 if e=runCmd("",runnerDir,"./svc.sh","install","tt-runner");e!=nil{return e}
 if e=runCmd("",runnerDir,"./svc.sh","start");e!=nil{return e}
 return nil
}
