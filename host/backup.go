package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

type backupDevice struct {
	ID      string `json:"id"`
	Serial  string `json:"serial"`
	Name    string `json:"name"`
	Builder string `json:"builder"`
	Chip    string `json:"chip"`
}
type backupManifest struct {
	Schema    int          `json:"schema"`
	Device    backupDevice `json:"device"`
	CreatedAt string       `json:"createdAt"`
	Size      int64        `json:"size"`
	SHA256    string       `json:"sha256"`
	File      string       `json:"file"`
	Scope     string       `json:"scope"`
}

var unsafeBackupName = regexp.MustCompile(`[^A-Za-z0-9.-]+`)

func backupPart(s string) string {
	s = unsafeBackupName.ReplaceAllString(s, "-")
	if len(s) > 60 {
		s = s[:60]
	}
	if s == "" || s == "." || s == ".." {
		return "unnamed"
	}
	return s
}

// Called by a device adapter with its exclusive device lock already held.
// This is not a device reader: callers must supply a freshly verified raw flash stream.
func backupToNFS(s *storageSpec, d backupDevice, source io.Reader, size int64) (string, error) {
	if err := validateStorage(s); err != nil {
		return "", err
	}
	target := filepath.Join("/var/lib/maincreate/storage", s.ID)
	raw, err := storageCommand("findmnt", "--json", "--mountpoint", target, "--output", "TARGET,SOURCE,FSTYPE")
	if err != nil {
		return "", errors.New("backup storage is not mounted")
	}
	if err = mountedStorage(raw, s, target); err != nil {
		return "", err
	}
	return writeBackup(target, d, source, size)
}
func writeBackup(root string, d backupDevice, source io.Reader, size int64) (string, error) {
	if d.ID == "" || d.Serial == "" || d.Chip == "" || size <= 0 || size > 256*1024*1024 {
		return "", errors.New("verified device identity and bounded flash size required")
	}
	folder := backupPart(d.Serial) + "_" + backupPart(d.Name) + "_" + backupPart(d.Builder)
	parent := filepath.Join(root, "Device Backups", folder)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil || resolved != parent {
		return "", errors.New("unsafe backup directory")
	}
	stage, err := os.MkdirTemp(parent, ".incomplete-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	path := filepath.Join(stage, "flash.bin")
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	sum := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(out, sum), io.LimitReader(source, size+1))
	syncErr := out.Sync()
	closeErr := out.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if syncErr != nil {
		return "", syncErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if n != size {
		return "", errors.New("backup length differs from verified flash size")
	}
	// Re-read the stored image before marking the backup complete.
	stored, err := os.Open(path)
	if err != nil {
		return "", err
	}
	verify := sha256.New()
	_, err = io.Copy(verify, stored)
	stored.Close()
	digest := hex.EncodeToString(sum.Sum(nil))
	if err != nil || hex.EncodeToString(verify.Sum(nil)) != digest {
		return "", errors.New("backup readback verification failed")
	}
	manifest := backupManifest{1, d, time.Now().UTC().Format(time.RFC3339Nano), size, digest, "flash.bin", "raw-flash-only; excludes eFuses and external storage"}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	mf, err := os.OpenFile(filepath.Join(stage, "manifest.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	_, err = mf.Write(data)
	if err == nil {
		err = mf.Sync()
	}
	ce := mf.Close()
	if err != nil {
		return "", err
	}
	if ce != nil {
		return "", ce
	}
	var nonce [8]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return "", err
	}
	destination := filepath.Join(parent, time.Now().UTC().Format("20060102T150405Z")+"-"+hex.EncodeToString(nonce[:]))
	if err = os.Rename(stage, destination); err != nil {
		return "", err
	}
	return destination, nil
}
