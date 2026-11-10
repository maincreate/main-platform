package main

import (
	"fmt"
	"testing"
)

func TestStorageValidation(t *testing.T) {
	good := storageSpec{ID: "12345678-1234-1234-1234-123456789abc", Server: "nas.example", ExportPath: "/volume1/backups"}
	if e := validateStorage(&good); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"/../etc", "/a/./b", "relative", "/a;touch"} {
		s := good
		s.ExportPath = path
		if validateStorage(&s) == nil {
			t.Fatal(path)
		}
	}
	for _, server := range []string{"-o", "host;id", "host:/etc", "host\nother"} {
		s := good
		s.Server = server
		if validateStorage(&s) == nil {
			t.Fatal(server)
		}
	}
	target := "/var/lib/maincreate/storage/" + good.ID
	raw := []byte(fmt.Sprintf(`{"filesystems":[{"target":%q,"source":"nas.example:/volume1/backups","fstype":"nfs4"}]}`, target))
	if e := mountedStorage(raw, &good, target); e != nil {
		t.Fatal(e)
	}
	if mountedStorage(raw, &good, target+"-other") == nil {
		t.Fatal("wrong mount accepted")
	}
	if mountedStorage([]byte(`{"filesystems":[{"target":"/","source":"/dev/sda","fstype":"ext4"}]}`), &good, target) == nil {
		t.Fatal("local fallback accepted")
	}
}
