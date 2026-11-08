package main

import (
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestRunnerArchiveLimits(t *testing.T) {
 mib:=int64(1<<20)
 cases:=[]struct{name string; total,size int64; ok bool}{
  {"large official member accepted",0,150*mib,true},
  {"member at cap accepted",0,maxRunnerMemberBytes,true},
  {"member above cap rejected",0,maxRunnerMemberBytes+1,false},
  {"negative member rejected",0,-1,false},
  {"expanded at cap accepted",maxRunnerExpandedBytes-100,100,true},
  {"expanded above cap rejected",maxRunnerExpandedBytes-100,101,false},
 }
 for _,tc:=range cases{
  t.Run(tc.name,func(t *testing.T){
   got,err:=countRunnerMember(tc.total,tc.size)
   if (err==nil)!=tc.ok{t.Fatalf("size=%d total=%d: err=%v, expected success=%v",tc.size,tc.total,err,tc.ok)}
   if tc.ok&&got!=tc.total+tc.size{t.Fatalf("expanded size got %d",got)}
  })
 }
}

func TestPrepareRunnerTargetPreservesIncompleteInstall(t *testing.T) {
 parent:=t.TempDir()
 dir:=filepath.Join(parent,"actions-runner")
 if err:=os.Mkdir(dir,0755);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(dir,"partial"),[]byte("previous extraction"),0600);err!=nil{t.Fatal(err)}
 if err:=prepareRunnerTarget(dir);err!=nil{t.Fatal(err)}
 if _,err:=os.Stat(dir);!os.IsNotExist(err){t.Fatalf("original partial path remains: %v",err)}
 matches,err:=filepath.Glob(dir+".incomplete-*")
 if err!=nil||len(matches)!=1{t.Fatalf("expected one preserved backup, got %v / %v",matches,err)}
 b,err:=os.ReadFile(filepath.Join(matches[0],"partial"))
 if err!=nil||string(b)!="previous extraction"{t.Fatalf("partial data not preserved: %v",err)}
}

func TestPrepareRunnerTargetRefusesRegisteredRunner(t *testing.T) {
 dir:=filepath.Join(t.TempDir(),"actions-runner")
 if err:=os.Mkdir(dir,0755);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(dir,".runner"),[]byte("registered"),0600);err!=nil{t.Fatal(err)}
 err:=prepareRunnerTarget(dir)
 if err==nil||!strings.Contains(err.Error(),"already registered"){t.Fatalf("unexpected error: %v",err)}
 if _,err:=os.Stat(filepath.Join(dir,".runner"));err!=nil{t.Fatalf("existing registration touched: %v",err)}
}
