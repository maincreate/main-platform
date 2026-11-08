// TinkerTunnel Host Service: controller-owned SSH pairing and outbound management.
package main

import (
 "bytes"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "log"
 "net/http"
 "os"
 "os/exec"
 "os/signal"
 "path/filepath"
 "runtime"
 "strings"
 "syscall"
 "time"
)

const version="0.6.0"
var dataDir=getenv("TT_HOST_DATA_DIR","/var/lib/tinkertunnel")
var configPath=filepath.Join(dataDir,"host.json")
var httpClient=&http.Client{Timeout:35*time.Second}

type config struct {ID string `json:"id"`; Token string `json:"token"`; Controller string `json:"controller"`; Name string `json:"name"`}
type joinRequest struct {Controller string `json:"controller"`; Invitation string `json:"invitation"`}
type action struct {
 ID string `json:"id"`
 Type string `json:"type"`
 Organization string `json:"organization"`
 RunnerName string `json:"runner_name"`
 Labels []string `json:"labels"`
 RegistrationToken string `json:"registration_token"`
 ExpiresAt string `json:"expires_at"`
 TargetVersion string `json:"target_version"`
 SHA256 string `json:"sha256"`
}
func getenv(k,f string)string{if s:=os.Getenv(k);s!=""{return s};return f}
func validController(s string)bool{return strings.HasPrefix(s,"https://")&&!strings.ContainsAny(strings.TrimPrefix(s,"https://"),"/?#@ ")&&len(s)<300}
func load()(config,error){
 var c config;b,e:=os.ReadFile(configPath);if e!=nil{return c,e}
 if e=json.Unmarshal(b,&c);e!=nil{return c,e}
 if !validController(c.Controller)||c.ID==""||len(c.Token)<32{return c,errors.New("invalid enrollment")};return c,nil
}
func post(origin,path,token string,body any,out any)error{
 b,e:=json.Marshal(body);if e!=nil{return e}
 r,e:=http.NewRequest("POST",origin+path,bytes.NewReader(b));if e!=nil{return e}
 r.Header.Set("Content-Type","application/json");if token!=""{r.Header.Set("Authorization","Bearer "+token)}
 res,e:=httpClient.Do(r);if e!=nil{return e};defer res.Body.Close()
 data,e:=io.ReadAll(io.LimitReader(res.Body,256*1024));if e!=nil{return e}
 if res.StatusCode<200||res.StatusCode>=300{return fmt.Errorf("controller %s returned HTTP %d",path,res.StatusCode)}
 if out!=nil{return json.Unmarshal(data,out)};return nil
}
func hostname()string{s,_:=os.Hostname();if s==""{return "tinkertunnel-host"};if len(s)>64{s=s[:64]};return s}
func join()error{
 if os.Geteuid()!=0{return errors.New("join requires root via installer-provided sudo rule")}
 if _,e:=load();e==nil{return errors.New("already enrolled; revoke at controller before re-pairing")}
 var req joinRequest
 if e:=json.NewDecoder(io.LimitReader(os.Stdin,4096)).Decode(&req);e!=nil{return fmt.Errorf("invalid pairing input: %w",e)}
 if !validController(req.Controller)||len(req.Invitation)<32{return errors.New("invalid controller or invitation")}
 var out struct{ID string `json:"id"`;Token string `json:"token"`}
 if e:=post(req.Controller,"/api/agent/enroll","",map[string]any{"token":req.Invitation,"name":hostname(),"os":"linux","arch":runtime.GOARCH},&out);e!=nil{return e}
 if out.ID==""||len(out.Token)<32{return errors.New("enrollment response missing credentials")}
 if e:=os.MkdirAll(dataDir,0700);e!=nil{return e}
 file:=filepath.Join(dataDir,"host.json.tmp");data,_:=json.MarshalIndent(config{ID:out.ID,Token:out.Token,Controller:req.Controller,Name:hostname()},"","  ")
 if e:=os.WriteFile(file,data,0600);e!=nil{return e}
 if e:=os.Rename(file,configPath);e!=nil{return e}
 fmt.Printf("Paired %s with %s (ID %s)\n",hostname(),req.Controller,out.ID);return nil
}
func packages()[]map[string]string{
 commands:=map[string][]string{"git":{"git","--version"},"python3":{"python3","--version"},"cmake":{"cmake","--version"},"node":{"node","--version"},"gcc":{"gcc","--version"},"esp-idf":{"idf.py","--version"}}
 var result []map[string]string
 for name,parts:=range commands{
  cmd:=exec.Command(parts[0],parts[1:]...);cmd.WaitDelay=time.Second;data,e:=cmd.Output()
  if e==nil{v:=strings.TrimSpace(strings.SplitN(string(data),"\n",2)[0]);if len(v)>90{v=v[:90]};result=append(result,map[string]string{"name":name,"version":v})}
 }
 return result
}
func advertise()func(){
 // Advertise the SSH pairing endpoint, not a publicly writable control API.
 cmd:=exec.Command("avahi-publish-service","TinkerTunnel "+hostname(),"_tinkertunnel._tcp","22","role=host","version="+version,"os=linux","arch="+runtime.GOARCH)
 if e:=cmd.Start();e!=nil{log.Printf("mDNS unavailable; manual hostname/IP pairing works: %v",e);return func(){}}
 go func(){if e:=cmd.Wait();e!=nil{log.Printf("mDNS exited: %v",e)}}()
 return func(){_ = cmd.Process.Kill()}
}
func report(c config,id string,ok bool,message string)error{
 if len(message)>1000{message=message[:1000]}
 return post(c.Controller,"/api/agent/actions/complete",c.Token,map[string]any{"id":c.ID,"action_id":id,"success":ok,"message":message},nil)
}
func run()error{
 if _,e:=load();e!=nil{log.Print("Unpaired; waiting for controller enrollment")}
 sig:=make(chan os.Signal,1);signal.Notify(sig,syscall.SIGTERM,syscall.SIGINT);stopAdvertising:=advertise();defer stopAdvertising()
 tick:=time.NewTicker(10*time.Second);defer tick.Stop()
 lastHeartbeat:=time.Time{};lastInventory:=time.Time{};lastDevices:=time.Time{}
 for {select{
 case <-sig:return nil
 case <-tick.C:
  c,e:=load();if e!=nil{continue}
  if time.Since(lastHeartbeat)>30*time.Second{
   if time.Since(lastInventory)>2*time.Minute{
    e=post(c.Controller,"/api/agent/heartbeat",c.Token,map[string]any{"id":c.ID,"hostVersion":version,"packages":packages()},nil);lastInventory=time.Now()
   }else{e=post(c.Controller,"/api/agent/heartbeat",c.Token,map[string]any{"id":c.ID,"hostVersion":version},nil)}
   if e!=nil{log.Printf("heartbeat: %v",e)};lastHeartbeat=time.Now()
  }
  // Read-only discovery occurs on startup and every minute. An unreadable
  // sysfs is NOT an empty inventory: preserve the previous observations.
  if os.Getenv("TT_HOST_DEVICE_DISCOVERY")!="0"&&time.Since(lastDevices)>60*time.Second{
   devices,scanErr:=scanUSBSerial()
   if scanErr!=nil{log.Printf("USB discovery: %v",scanErr)}else{
    if postErr:=post(c.Controller,"/api/agent/devices",c.Token,
      map[string]any{"id":c.ID,"devices":devices},nil);postErr!=nil{
     log.Printf("USB inventory report: %v",postErr)
    }
   }
   lastDevices=time.Now()
  }
  var out struct{Action *action `json:"action"`}
  if e=post(c.Controller,"/api/agent/actions/claim",c.Token,map[string]string{"id":c.ID},&out);e!=nil{log.Printf("action polling: %v",e);continue}
  if out.Action==nil{continue}
  a:=out.Action
  if a.Type=="host.upgrade"{e=stageUpgrade(c,*a)}else{e=execute(a)}
  message:="completed"
  if e!=nil{message=e.Error();log.Printf("action %s failed: %s",a.ID,message)}
  if e2:=report(c,a.ID,e==nil,message);e2!=nil{log.Printf("report action: %v",e2)}else if e==nil&&a.Type=="host.upgrade"{
   if err:=runCmd("","","systemd-run","--unit=tinkertunnel-host-upgrade","--on-active=5s",
    "/usr/local/bin/tinkertunnel-host","apply-upgrade");err!=nil{log.Printf("schedule upgrade: %v",err)}
  }
 }}
}
func safeOrg(s string)bool{
 if len(s)<1||len(s)>80{return false};for _,c:=range s{if c!='-'&&c!='_'&&(c<'0'||c>'9')&&(c<'A'||c>'Z')&&(c<'a'||c>'z'){return false}};return true
}
func safeName(s string)bool{
 if len(s)<1||len(s)>60{return false};for _,c:=range s{if c!='-'&&c!='_'&&c!='.'&&(c<'0'||c>'9')&&(c<'A'||c>'Z')&&(c<'a'||c>'z'){return false}};return true
}
func execute(a *action)error{
 expires,e:=time.Parse(time.RFC3339,a.ExpiresAt)
 if e!=nil||time.Now().After(expires){return errors.New("host instruction expired")}
 switch a.Type{
 case "github-runner.provision":
  if !safeOrg(a.Organization)||!safeName(a.RunnerName)||len(a.RegistrationToken)<15{
   return errors.New("invalid runner registration instruction")
  }
  for _,l:=range a.Labels{if !safeName(l){return errors.New("invalid label")}}
  return provisionRunner(*a)
 case "github-runner.stop","host.cleanup":
  if !safeName(a.RunnerName)||a.RunnerName!=hostname()||a.RegistrationToken!=""{
   return errors.New("decommission action must match this host and contain no registration token")
  }
  if os.Geteuid()!=0{return errors.New("host decommission requires root")}
  if a.Type=="github-runner.stop"{return stopManagedRunner()}
  return cleanupManagedHost()
 default:
  return errors.New("unsupported action")
 }
}
func validUpgradeVersion(v string)bool{
 parts:=strings.Split(v,".");if len(parts)!=3{return false}
 for _,p:=range parts{
  if len(p)==0||len(p)>8{return false}
  for _,ch:=range p{if ch<'0'||ch>'9'{return false}}
 }
 return true
}
func compareUpgradeVersions(a,b string)int{
 if !validUpgradeVersion(a)||!validUpgradeVersion(b){return -1}
 aa,bb:=strings.Split(a,"."),strings.Split(b,".")
 for i:=0;i<3;i++{
  // Short decimal version components: lexical length first, then digits.
  if len(aa[i])>len(bb[i]){return 1};if len(aa[i])<len(bb[i]){return -1}
  if aa[i]>bb[i]{return 1};if aa[i]<bb[i]{return -1}
 }
 return 0
}
// Upgrade is a constrained host action: only the enrolled controller's binary,
// pinned by SHA-256 in the queued instruction. No arbitrary URL or shell command.
func stageUpgrade(c config,a action)error{
 if !safeName(a.RunnerName)||a.RunnerName!=hostname()||a.RegistrationToken!=""{
  return errors.New("invalid host upgrade instruction")
 }
 // The instruction names the expected release; the remote binary is served by
 // the same HTTPS controller the host already trusts for enrollment.
 if len(a.SHA256)!=64||!validUpgradeVersion(a.TargetVersion)||
  compareUpgradeVersions(a.TargetVersion,version)<=0{return errors.New("invalid or non-incremental upgrade metadata")}
 expires,e:=time.Parse(time.RFC3339,a.ExpiresAt);if e!=nil||time.Now().After(expires){return errors.New("upgrade instruction expired")}
 if os.Geteuid()!=0{return errors.New("upgrade requires root")}
 if runtime.GOOS!="linux"||runtime.GOARCH!="arm64"{return errors.New("unsupported upgrade platform")}
 expected,e:=hex.DecodeString(a.SHA256);if e!=nil||len(expected)!=32{return errors.New("invalid expected checksum")}
 url:=c.Controller+"/downloads/tinkertunnel-host-linux-arm64"
 req,e:=http.NewRequest(http.MethodGet,url,nil);if e!=nil{return e}
 res,e:=httpClient.Do(req);if e!=nil{return e};defer res.Body.Close()
 if res.StatusCode!=200{return fmt.Errorf("upgrade download HTTP %d",res.StatusCode)}
 binary,e:=io.ReadAll(io.LimitReader(res.Body,32*1024*1024+1));if e!=nil{return e}
 if len(binary)<1024||len(binary)>32*1024*1024||!bytes.Equal(binary[:4],[]byte{0x7f,'E','L','F'}){return errors.New("invalid upgrade binary")}
 sum:=sha256.Sum256(binary);if !bytes.Equal(sum[:],expected){return errors.New("upgrade digest mismatch")}
 if e=os.MkdirAll(dataDir,0700);e!=nil{return e}
 staged:=filepath.Join(dataDir,"upgrade-pending")
 if e=os.WriteFile(staged+".tmp",binary,0700);e!=nil{return e}
 if e=os.Rename(staged+".tmp",staged);e!=nil{return e}
 if e=os.WriteFile(filepath.Join(dataDir,"upgrade-target"),[]byte(a.TargetVersion),0600);e!=nil{return e}
 return nil
}
// This command is executed by systemd independently after the controller ACK.
// It retains the previous executable for automatic rollback on restart failure.
func applyUpgrade()error{
 if os.Geteuid()!=0{return errors.New("upgrade requires root")}
 staged:=filepath.Join(dataDir,"upgrade-pending")
 target,e:=os.ReadFile(filepath.Join(dataDir,"upgrade-target"));if e!=nil{return e}
 if !validUpgradeVersion(string(target)){return errors.New("invalid staged target")}
 oldPath:="/usr/local/bin/tinkertunnel-host"
 backup:=filepath.Join(dataDir,"host-previous")
 old,e:=os.ReadFile(oldPath);if e!=nil{return e}
 if e=os.WriteFile(backup,old,0700);e!=nil{return e}
 next,e:=os.ReadFile(staged);if e!=nil{return e}
 swap:=oldPath+".next"
 if e=os.WriteFile(swap,next,0700);e!=nil{return e}
 if e=os.Rename(swap,oldPath);e!=nil{return e}
 if e=runCmd("","","systemctl","restart","tinkertunnel-host.service");e!=nil{
  _=os.WriteFile(swap,old,0700);_=os.Rename(swap,oldPath)
  _=runCmd("","","systemctl","restart","tinkertunnel-host.service")
  return e
 }
 time.Sleep(4*time.Second)
 if e=runCmd("","","systemctl","is-active","--quiet","tinkertunnel-host.service");e!=nil{
  _=os.WriteFile(swap,old,0700);_=os.Rename(swap,oldPath)
  _=runCmd("","","systemctl","restart","tinkertunnel-host.service")
  return errors.New("new host service failed health check; rolled back")
 }
 _=os.Remove(staged);_=os.Remove(filepath.Join(dataDir,"upgrade-target"))
 return nil
}

// Remove only explicitly TinkerTunnel-managed paths; never uninstall SSH or Avahi.
// Cleanup of this running daemon is scheduled after its report has reached the controller.
func stopManagedRunner()error{
 service:=filepath.Join(runnerDir,".service")
 if _,e:=os.Lstat(service);errors.Is(e,os.ErrNotExist){return nil}else if e!=nil{return e}
 return runCmd("",runnerDir,"./svc.sh","stop")
}
func cleanupManagedHost()error{
 if e:=stopManagedRunner();e!=nil{return e}
 if _,e:=os.Lstat(filepath.Join(runnerDir,".service"));e==nil{
  if e=runCmd("",runnerDir,"./svc.sh","uninstall");e!=nil{return e}
 }else if !errors.Is(e,os.ErrNotExist){return e}
 if e:=os.RemoveAll(runnerDir);e!=nil{return e}
 // The delayed one-shot is independent of this service; it stops and removes
 // the Host Service only after the completed action has been acknowledged.
 script:="/run/tinkertunnel-finalize.sh"
 contents:=`#!/bin/sh
set -eu
systemctl disable --now tinkertunnel-host.service
rm -f /etc/systemd/system/tinkertunnel-host.service /usr/local/bin/tinkertunnel-host /etc/sudoers.d/90-tinkertunnel-pair
systemctl daemon-reload
rm -rf /var/lib/tinkertunnel
rm -f /run/tinkertunnel-finalize.sh
`
 if e:=os.WriteFile(script,[]byte(contents),0700);e!=nil{return e}
 return runCmd("","","systemd-run","--unit=tinkertunnel-finalize","--on-active=8s",
  "--property=Type=oneshot","/bin/sh",script)
}
func main(){
 command:="";if len(os.Args)>1{command=os.Args[1]}
 var err error;switch command{case "join":err=join();case "serve":err=run();case "version":fmt.Println(version);case "apply-upgrade":err=applyUpgrade();default:err=errors.New("usage: tinkertunnel-host serve|join|version|apply-upgrade")}
 if err!=nil{log.Fatal(err)}
}
