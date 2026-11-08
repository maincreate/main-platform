package main

import "testing"

func TestValidController(t *testing.T) {
 for _,tc:=range []struct{url string;want bool}{
  {"https://tinkertunnel.home.ayusohaylock.com",true},{"https://pi.local:8443",true},
  {"http://pi.local",false},{"https://evil.com/path",false},{"https://user@evil.com",false},
 }{
  if validController(tc.url)!=tc.want { t.Fatalf("controller validation %q",tc.url) }
 }
}
func TestNames(t *testing.T){
 for _,s:=range []string{"tt-pi","runner_1","tt.arm64"} {if !safeName(s){t.Fatalf("rejected %q",s)}}
 for _,s:=range []string{"../../etc/passwd","bad name","a/b"} {if safeName(s){t.Fatalf("accepted %q",s)}}
}
func TestUnsupportedActions(t *testing.T){
 if err:=execute(&action{Type:"arbitrary.shell"});err==nil {t.Fatal("arbitrary action accepted")}
}
