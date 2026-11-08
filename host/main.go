// TinkerTunnel Host Service: controller-owned SSH pairing and outbound management.
package main

import (
 "bytes"
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

const version="0.4.0"
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
func advertise(stop <-chan os.Signal){
 // Advertise the SSH pairing endpoint, not a publicly writable control API.
 cmd:=exec.Command("avahi-publish-service","TinkerTunnel "+hostname(),"_tinkertunnel._tcp","22","role=host","version="+version,"os=linux","arch="+runtime.GOARCH)
 if e:=cmd.Start();e!=nil{log.Printf("mDNS unavailable; manual hostname/IP pairing works: %v",e);return}
 go func(){<-stop;_ = cmd.Process.Kill()}()
 go func(){if e:=cmd.Wait();e!=nil{log.Printf("mDNS exited: %v",e)}}()
}
func report(c config,id string,ok bool,message string)error{
 if len(message)>1000{message=message[:1000]}
 return post(c.Controller,"/api/agent/actions/complete",c.Token,map[string]any{"id":c.ID,"action_id":id,"success":ok,"message":message},nil)
}
func run()error{
 if _,e:=load();e!=nil{log.Print("Unpaired; waiting for controller enrollment")}
 sig:=make(chan os.Signal,1);signal.Notify(sig,syscall.SIGTERM,syscall.SIGINT);advertise(sig)
 tick:=time.NewTicker(10*time.Second);defer tick.Stop()
 lastHeartbeat:=time.Time{};lastInventory:=time.Time{}
 for {select{
 case <-sig:return nil
 case <-tick.C:
  c,e:=load();if e!=nil{continue}
  if time.Since(lastHeartbeat)>30*time.Second{
   if time.Since(lastInventory)>2*time.Minute{
    e=post(c.Controller,"/api/agent/heartbeat",c.Token,map[string]any{"id":c.ID,"packages":packages()},nil);lastInventory=time.Now()
   }else{e=post(c.Controller,"/api/agent/heartbeat",c.Token,map[string]any{"id":c.ID},nil)}
   if e!=nil{log.Printf("heartbeat: %v",e)};lastHeartbeat=time.Now()
  }
  var out struct{Action *action `json:"action"`}
  if e=post(c.Controller,"/api/agent/actions/claim",c.Token,map[string]string{"id":c.ID},&out);e!=nil{log.Printf("action polling: %v",e);continue}
  if out.Action==nil{continue}
  a:=out.Action;e=execute(a);message:="completed"
  if e!=nil{message=e.Error();log.Printf("action %s failed: %s",a.ID,message)}
  if e2:=report(c,a.ID,e==nil,message);e2!=nil{log.Printf("report action: %v",e2)}
 }}
}
func safeOrg(s string)bool{
 if len(s)<1||len(s)>80{return false};for _,c:=range s{if c!='-'&&c!='_'&&(c<'0'||c>'9')&&(c<'A'||c>'Z')&&(c<'a'||c>'z'){return false}};return true
}
func safeName(s string)bool{
 if len(s)<1||len(s)>60{return false};for _,c:=range s{if c!='-'&&c!='_'&&c!='.'&&(c<'0'||c>'9')&&(c<'A'||c>'Z')&&(c<'a'||c>'z'){return false}};return true
}
func execute(a *action)error{
 if a.Type!="github-runner.provision"{return errors.New("unsupported action")}
 expires,e:=time.Parse(time.RFC3339,a.ExpiresAt);if e!=nil||time.Now().After(expires){return errors.New("registration instruction expired")}
 if !safeOrg(a.Organization)||!safeName(a.RunnerName)||len(a.RegistrationToken)<15{return errors.New("invalid runner registration instruction")}
 for _,l:=range a.Labels{if !safeName(l){return errors.New("invalid label")}}
 return provisionRunner(*a)
}
func main(){
 command:="";if len(os.Args)>1{command=os.Args[1]}
 var err error;switch command{case "join":err=join();case "serve":err=run();case "version":fmt.Println(version);default:err=errors.New("usage: tinkertunnel-host serve|join|version")}
 if err!=nil{log.Fatal(err)}
}
