#!/usr/bin/env python3
"""Deterministic firmware artifact manifest generator; no flashing."""
import argparse
import hashlib
import json
from pathlib import Path

def package(source: Path, output: Path, commit: str) -> Path:
    if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
        raise ValueError("commit must be a full lowercase SHA-1")
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError("non-empty firmware binary required")
    output.mkdir(parents=True, exist_ok=True)
    dst = output / "firmware.bin"
    if source.resolve() != dst.resolve():
        dst.write_bytes(source.read_bytes())
    checksum = hashlib.sha256(dst.read_bytes()).hexdigest()
    manifest = {
        "schema_version": 1,
        "project": "waymarkeros",
        "commit": commit,
        "artifact": "firmware.bin",
        "bytes": dst.stat().st_size,
        "sha256": checksum,
        "flash_policy": "manual_via_fabric_after_verify",
    }
    path = output / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return path

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--commit", required=True)
    a = parser.parse_args()
    print(package(a.source, a.output, a.commit))
