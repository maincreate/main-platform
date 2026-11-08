package main

import "testing"

func TestUpgradeVersions(t *testing.T) {
 for _,tc:=range []struct{version string; valid bool}{
  {"0.5.0",true},{"1.2.3",true},{"1.10.0",true},
  {"0.5.0-rc1",false},{"../../evil",false},{"0.5",false},{"0.5.0/",false},
 } {
  if got:=validUpgradeVersion(tc.version);got!=tc.valid {t.Fatalf("%s valid=%t, want %t",tc.version,got,tc.valid)}
 }
 if compareUpgradeVersions("0.6.0","0.5.0")<=0 {t.Fatal("later version not accepted")}
 if compareUpgradeVersions("0.5.0","0.5.0")!=0 {t.Fatal("same version must be equal")}
 if compareUpgradeVersions("0.4.9","0.5.0")>=0 {t.Fatal("downgrade must be rejected")}
 if compareUpgradeVersions("1.10.0","1.9.0")<=0 {t.Fatal("numeric version ordering is incorrect")}
}
