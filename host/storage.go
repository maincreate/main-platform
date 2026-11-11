package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type storageSpec struct {
	ID         string `json:"id"`
	Server     string `json:"server"`
	ExportPath string `json:"export_path"`
}

var storageID = regexp.MustCompile(`^[a-f0-9-]{36}$`)
var storageServer = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]*$`)
var storageExport = regexp.MustCompile(`^/[A-Za-z0-9_./-]*$`)

func validateStorage(s *storageSpec) error {
	if s == nil || !storageID.MatchString(s.ID) || len(s.Server) > 253 || !storageServer.MatchString(s.Server) || len(s.ExportPath) > 512 || !storageExport.MatchString(s.ExportPath) {
		return errors.New("invalid NFS assignment")
	}
	for _, part := range strings.Split(s.ExportPath, "/") {
		if part == ".." || part == "." {
			return errors.New("invalid NFS export")
		}
	}
	return nil
}
func storageCommand(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Output()
}
func mountedStorage(raw []byte, s *storageSpec, target string) error {
	var result struct {
		Filesystems []struct {
			Target string `json:"target"`
			Source string `json:"source"`
			Type   string `json:"fstype"`
		} `json:"filesystems"`
	}
	if json.Unmarshal(raw, &result) != nil || len(result.Filesystems) != 1 {
		return errors.New("NFS mount is not present")
	}
	f := result.Filesystems[0]
	if f.Target != target || f.Source != s.Server+":"+s.ExportPath || (f.Type != "nfs" && f.Type != "nfs4") {
		return errors.New("mount does not match assigned NFS export")
	}
	return nil
}
func mountStorage(s *storageSpec) error {
	if err := validateStorage(s); err != nil {
		return err
	}
	if os.Geteuid() != 0 {
		return errors.New("NFS mounting requires the managed root host service")
	}
	root := "/var/lib/maincreate/storage"
	target := filepath.Join(root, s.ID)
	// Never follow a substituted local path to mount or write outside managed storage.
	if err := os.MkdirAll(target, 0700); err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil || resolved != target {
		return errors.New("unsafe storage mount path")
	}
	raw, err := storageCommand("findmnt", "--json", "--mountpoint", target, "--output", "TARGET,SOURCE,FSTYPE")
	if err != nil {
		if _, err = storageCommand("mount", "-t", "nfs", "-o", "vers=4,hard,nosuid,nodev,noexec", s.Server+":"+s.ExportPath, target); err != nil {
			return errors.New("NFS mount failed; check export access and installed NFS client")
		}
		raw, err = storageCommand("findmnt", "--json", "--mountpoint", target, "--output", "TARGET,SOURCE,FSTYPE")
	}
	if err != nil {
		return errors.New("could not verify NFS mount")
	}
	if err = mountedStorage(raw, s, target); err != nil {
		return err
	}
	// Root-squashed exports must permit the service's mapped identity to write.
	dir := filepath.Join(target, "Device Backups")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("backup directory unavailable: %w", err)
	}
	resolved, err = filepath.EvalSymlinks(dir)
	if err != nil || resolved != dir {
		return errors.New("unsafe backup directory")
	}
	probe, err := os.CreateTemp(dir, ".maincreate-write-check-")
	if err != nil {
		return errors.New("NFS mounted but backup directory is not writable")
	}
	name := probe.Name()
	defer os.Remove(name)
	if _, err = probe.WriteString("MainCreate storage validation\n"); err != nil {
		probe.Close()
		return err
	}
	if err = probe.Sync(); err != nil {
		probe.Close()
		return err
	}
	return probe.Close()
}
