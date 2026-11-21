// Main{Create} Host Service: outbound management, typed Fabric execution, and host lifecycle.
package main

import (
 "bytes"
 "crypto/sha256"
 "encoding/hex"
 "encoding/base64"
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
 "strconv"
 "strings"
 "syscall"
 "time"
)

const version="0.8.2"
var dataDir=getenv("MAIN_HOST_DATA_DIR","/var/lib/maincreate")
var configPath=filepath.Join(dataDir,"host.json")
var httpClient=&http.Client{Timeout:35*time.Second}

type config struct {ID string `json:"id"`; Token string `json:"token"`; Controller string `json:"controller"`; Name string `json:"name"`}
type joinRequest struct {Controller string `json:"controller"`; Invitation string `json:"invitation"`}
type action struct {
 Storage *storageSpec `json:"storage,omitempty"`
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
func controllerArchFor(arch string)string{
 switch arch {case "amd64":return "x64";case "arm64":return "arm64";default:return arch}
}
func hostBinaryNameFor(arch string)string{
 switch arch {case "amd64","arm64":return "maincreate-host-linux-"+arch;default:return ""}
}
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
func hostname()string{s,_:=os.Hostname();if s==""{return "maincreate-host"};if len(s)>64{s=s[:64]};return s}
func join()error{
 if os.Geteuid()!=0{return errors.New("join requires root via installer-provided sudo rule")}
 if _,e:=load();e==nil{return errors.New("already enrolled; revoke at controller before re-pairing")}
 var req joinRequest
 if e:=json.NewDecoder(io.LimitReader(os.Stdin,4096)).Decode(&req);e!=nil{return fmt.Errorf("invalid pairing input: %w",e)}
 if !validController(req.Controller)||len(req.Invitation)<32{return errors.New("invalid controller or invitation")}
 var out struct{ID string `json:"id"`;Token string `json:"token"`}
 if e:=post(req.Controller,"/api/agent/enroll","",map[string]any{"token":req.Invitation,"name":hostname(),"os":"linux","arch":controllerArchFor(runtime.GOARCH)},&out);e!=nil{return e}
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
 cmd:=exec.Command("avahi-publish-service","Main{Create} "+hostname(),"_maincreate._tcp","22","role=host","version="+version,"os=linux","arch="+controllerArchFor(runtime.GOARCH))
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
 storageBusy:=make(chan struct{},1)
 lastHeartbeat:=time.Time{};lastInventory:=time.Time{};lastDevices:=time.Time{}
 for {select{
 case <-sig:return nil
 case <-tick.C:
  c,e:=load();if e!=nil{continue}
  if time.Since(lastHeartbeat)>30*time.Second{
   if time.Since(lastInventory)>2*time.Minute{
    e=post(c.Controller,"/api/agent/heartbeat",c.Token,map[string]any{"id":c.ID,"hostVersion":version,"fabricCapabilities":[]string{"host.snapshot"},"packages":packages()},nil);lastInventory=time.Now()
   }else{e=post(c.Controller,"/api/agent/heartbeat",c.Token,map[string]any{"id":c.ID,"hostVersion":version,"fabricCapabilities":[]string{"host.snapshot"}},nil)}
   if e!=nil{log.Printf("heartbeat: %v",e)};lastHeartbeat=time.Now()
  }
  // Read-only discovery occurs on startup and every minute. An unreadable
  // sysfs is NOT an empty inventory: preserve the previous observations.
  if os.Getenv("MAIN_HOST_DEVICE_DISCOVERY")!="0"&&time.Since(lastDevices)>60*time.Second{
   devices,scanErr:=scanUSBSerial()
   if scanErr!=nil{log.Printf("USB discovery: %v",scanErr)}else{
    if postErr:=post(c.Controller,"/api/agent/devices",c.Token,
      map[string]any{"id":c.ID,"devices":devices},nil);postErr!=nil{
     log.Printf("USB inventory report: %v",postErr)
    }
   }
   lastDevices=time.Now()
  }
  if len(storageBusy)>0{continue}
  if err:=pollFabric(c);err!=nil{log.Printf("fabric job polling: %v",err)}
  var out struct{Action *action `json:"action"`}
  if e=post(c.Controller,"/api/agent/actions/claim",c.Token,map[string]string{"id":c.ID},&out);e!=nil{log.Printf("action polling: %v",e);continue}
  if out.Action==nil{continue}
  a:=out.Action
  if a.Type=="storage.nfs.mount"{
   storageBusy<-struct{}{}
   go func(task action,host config){
    defer func(){<-storageBusy}()
    err:=execute(&task);message:="NFS mount and write check completed"
    if err!=nil{message=err.Error()}
    if err=report(host,task.ID,err==nil,message);err!=nil{log.Printf("storage report: %v",err)}
   }(*a,c)
   continue
  }
  if a.Type=="host.upgrade"{e=stageUpgrade(c,*a)}else{e=execute(a)}
  message:="completed"
  if e!=nil{message=e.Error();log.Printf("action %s failed: %s",a.ID,message)}
  if e2:=report(c,a.ID,e==nil,message);e2!=nil{log.Printf("report action: %v",e2)}else if e==nil&&a.Type=="host.upgrade"{
   if err:=runCmd("","","systemd-run","--unit=maincreate-host-upgrade","--on-active=5s",
    "/usr/local/bin/maincreate-host","apply-upgrade");err!=nil{log.Printf("schedule upgrade: %v",err)}
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
 case "storage.nfs.mount":
  return mountStorage(a.Storage)
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
 if runtime.GOOS!="linux"||hostBinaryNameFor(runtime.GOARCH)==""{return errors.New("unsupported upgrade platform")}
 expected,e:=hex.DecodeString(a.SHA256);if e!=nil||len(expected)!=32{return errors.New("invalid expected checksum")}
 url:=c.Controller+"/downloads/"+hostBinaryNameFor(runtime.GOARCH)
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
 oldPath:="/usr/local/bin/maincreate-host"
 backup:=filepath.Join(dataDir,"host-previous")
 old,e:=os.ReadFile(oldPath);if e!=nil{return e}
 if e=os.WriteFile(backup,old,0700);e!=nil{return e}
 next,e:=os.ReadFile(staged);if e!=nil{return e}
 swap:=oldPath+".next"
 if e=os.WriteFile(swap,next,0700);e!=nil{return e}
 if e=os.Rename(swap,oldPath);e!=nil{return e}
 if e=runCmd("","","systemctl","restart","maincreate-host.service");e!=nil{
  _=os.WriteFile(swap,old,0700);_=os.Rename(swap,oldPath)
  _=runCmd("","","systemctl","restart","maincreate-host.service")
  return e
 }
 time.Sleep(4*time.Second)
 if e=runCmd("","","systemctl","is-active","--quiet","maincreate-host.service");e!=nil{
  _=os.WriteFile(swap,old,0700);_=os.Rename(swap,oldPath)
  _=runCmd("","","systemctl","restart","maincreate-host.service")
  return errors.New("new host service failed health check; rolled back")
 }
 _=os.Remove(staged);_=os.Remove(filepath.Join(dataDir,"upgrade-target"))
 return nil
}

// Remove only explicitly Main{Create}-managed paths; never uninstall SSH or Avahi.
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
 script:="/run/maincreate-finalize.sh"
 contents:=`#!/bin/sh
set -eu
systemctl disable --now maincreate-host.service
rm -f /etc/systemd/system/maincreate-host.service /usr/local/bin/maincreate-host /etc/sudoers.d/90-maincreate-pair
systemctl daemon-reload
rm -rf /var/lib/maincreate
rm -f /run/maincreate-finalize.sh
`
 if e:=os.WriteFile(script,[]byte(contents),0700);e!=nil{return e}
 return runCmd("","","systemd-run","--unit=maincreate-finalize","--on-active=8s",
  "--property=Type=oneshot","/bin/sh",script)
}
func main(){
 command:="";if len(os.Args)>1{command=os.Args[1]}
 var err error;switch command{case "join":err=join();case "serve":err=run();case "version":fmt.Println(version);case "apply-upgrade":err=applyUpgrade();default:err=errors.New("usage: maincreate-host serve|join|version|apply-upgrade")}
 if err!=nil{log.Fatal(err)}
}


// The managed Host Service also executes bounded Fabric jobs. The controller
// filters by declared capabilities, so this process never claims firmware or
// installer jobs that need their own reviewed adapters.
type fabricStep struct{ Capability string }
type fabricJob struct{ ID string; Steps []fabricStep }

func hostSnapshot(c config)([]byte,error){
 if runtime.GOOS!="linux"{return nil,errors.New("host snapshot requires Linux")}
 raw,err:=os.ReadFile("/proc/meminfo");if err!=nil{return nil,err}
 var total,available uint64
 for _,line:=range strings.Split(string(raw),"\n"){
  fields:=strings.Fields(line);if len(fields)<2{continue}
  n,e:=strconv.ParseUint(fields[1],10,64);if e!=nil{continue}
  switch fields[0]{
  case "MemTotal:":total=n*1024
  case "MemAvailable:":available=n*1024
  case "MemFree:":if available==0{available=n*1024}
  }
 }
 if total==0{return nil,errors.New("kernel memory inventory unavailable")}
 up,err:=os.ReadFile("/proc/uptime");if err!=nil{return nil,err}
 fields:=strings.Fields(string(up));if len(fields)==0{return nil,errors.New("kernel uptime unavailable")}
 secs,err:=strconv.ParseFloat(fields[0],64);if err!=nil{return nil,err}
 return json.MarshalIndent(map[string]any{
  "host":c.Name,"os":runtime.GOOS,"architecture":controllerArchFor(runtime.GOARCH),
  "hostname":hostname(),"cpus":runtime.NumCPU(),"totalMemoryBytes":total,
  "freeMemoryBytes":available,"uptimeSeconds":int64(secs),
  "hostServiceVersion":version,"observedAt":time.Now().UTC().Format(time.RFC3339),
 },"","  ")
}
func uploadFabricSnapshot(c config,jobID string,payload []byte)error{
 if len(payload)<1||len(payload)>8*1024*1024{return errors.New("host snapshot exceeds artifact limit")}
 var begin struct{Asset struct{ID string};MaxChunkBytes int}
 start:=map[string]any{"id":c.ID,"job_id":jobID,"action":"begin",
  "name":"host-snapshot.json","mime":"application/json","size":len(payload)}
 if err:=post(c.Controller,"/api/agent/assets",c.Token,start,&begin);err!=nil{return err}
 if begin.Asset.ID==""{return errors.New("artifact begin missing ID")}
 size:=48*1024;if begin.MaxChunkBytes>0&&begin.MaxChunkBytes<size{size=begin.MaxChunkBytes}
 for offset:=0;offset<len(payload);offset+=size{
  end:=offset+size;if end>len(payload){end=len(payload)}
  chunk:=map[string]any{"id":c.ID,"job_id":jobID,"action":"chunk",
   "asset_id":begin.Asset.ID,"offset":offset,
   "content_base64":base64.StdEncoding.EncodeToString(payload[offset:end])}
  if err:=post(c.Controller,"/api/agent/assets",c.Token,chunk,nil);err!=nil{return err}
 }
 digest:=sha256.Sum256(payload)
 finish:=map[string]any{"id":c.ID,"job_id":jobID,"action":"finish",
  "asset_id":begin.Asset.ID,"sha256":hex.EncodeToString(digest[:])}
 return post(c.Controller,"/api/agent/assets",c.Token,finish,nil)
}
func executeFabricJob(c config,job fabricJob)error{
 if job.ID==""||len(job.Steps)==0||len(job.Steps)>8{return errors.New("invalid claimed Fabric job")}
 statuses:=make([]map[string]string,0,len(job.Steps));failed:=false
 logLines:=[]string{}
 for _,step:=range job.Steps{
  status:="completed"
  if failed{status="skipped"}else if step.Capability!="host.snapshot"{
   status="failed";failed=true;logLines=append(logLines,"Unsupported Fabric capability: "+step.Capability)
  }else{
   data,err:=hostSnapshot(c)
   if err==nil{err=uploadFabricSnapshot(c,job.ID,data)}
   if err!=nil{
    status="failed";failed=true;logLines=append(logLines,"Host snapshot failed: "+err.Error())
   }else{logLines=append(logLines,"Host snapshot recorded and SHA-256 verified")}
  }
  statuses=append(statuses,map[string]string{"capability":step.Capability,"status":status})
 }
 logs:=strings.Join(logLines,"\n")
 if len(logs)>24000{logs=logs[:24000]}
 completion:=map[string]any{"id":c.ID,"job_id":job.ID,"success":!failed,
  "logs":logs,"steps":statuses}
 if err:=post(c.Controller,"/api/agent/jobs/complete",c.Token,completion,nil);err!=nil{return err}
 log.Printf("Fabric job %s completed; success=%t",job.ID,!failed)
 return nil
}
func pollFabric(c config)error{
 var response struct{Job *fabricJob}
 request:=map[string]any{"id":c.ID,"capabilities":[]string{"host.snapshot"}}
 if err:=post(c.Controller,"/api/agent/jobs/claim",c.Token,request,&response);err!=nil{return err}
 if response.Job==nil{return nil}
 return executeFabricJob(c,*response.Job)
}
