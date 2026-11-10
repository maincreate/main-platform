package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupCommitAndReadback(t *testing.T) {
	root := t.TempDir()
	d := backupDevice{"stable-id", "1234", "My Device", "pi", "esp32s3"}
	path, e := writeBackup(root, d, strings.NewReader("firmware"), 8)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile(filepath.Join(path, "manifest.json"))
	if e != nil {
		t.Fatal(e)
	}
	var m backupManifest
	if json.Unmarshal(raw, &m) != nil || m.Device.ID != d.ID || m.Size != 8 || len(m.SHA256) != 64 {
		t.Fatal(string(raw))
	}
	for _, data := range []string{"short", "too-long-image"} {
		if _, e = writeBackup(root, d, strings.NewReader(data), 8); e == nil {
			t.Fatal("wrong length accepted")
		}
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatal("incomplete backup leaked")
	}
}
func TestBackupNames(t *testing.T) {
	for _, s := range []string{"../escape", "a/b", "a\\b", "..", ""} {
		p := backupPart(s)
		if p == ".." || strings.ContainsAny(p, "/\\") {
			t.Fatal(p)
		}
	}
}
