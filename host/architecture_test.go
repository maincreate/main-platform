package main

import "testing"

func TestControllerArchMapping(t *testing.T) {
 for _,tc:=range []struct{in,want string}{{"amd64","x64"},{"arm64","arm64"},{"386","386"}} {
  if got:=controllerArchFor(tc.in);got!=tc.want {t.Errorf("controllerArchFor(%q)=%q, want %q",tc.in,got,tc.want)}
 }
}
func TestHostBinaryName(t *testing.T) {
 for _,tc:=range []struct{in,want string}{{"amd64","maincreate-host-linux-amd64"},{"arm64","maincreate-host-linux-arm64"},{"386",""}} {
  if got:=hostBinaryNameFor(tc.in);got!=tc.want {t.Errorf("binary(%q)=%q, want %q",tc.in,got,tc.want)}
 }
}
func TestGithubRunnerAssetArch(t *testing.T) {
 for _,tc:=range []struct{in,want string}{{"amd64","x64"},{"arm64","arm64"},{"386",""}} {
  if got:=githubRunnerAssetArch(tc.in);got!=tc.want {t.Errorf("asset(%q)=%q, want %q",tc.in,got,tc.want)}
 }
}
