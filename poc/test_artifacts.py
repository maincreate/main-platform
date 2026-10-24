import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from artifacts import package

class PackageTest(unittest.TestCase):
    def test_manifest_and_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = b"waymarker-ci-poc"
            (root / "source.bin").write_bytes(data)
            manifest_path = package(root / "source.bin", root / "out", "a" * 40)
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual((root / "out" / "firmware.bin").read_bytes(), data)
            self.assertEqual(manifest["flash_policy"], "manual_via_fabric_after_verify")

    def test_reject_missing_and_bad_ref(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "empty.bin").write_bytes(b"")
            with self.assertRaises(ValueError):
                package(root / "empty.bin", root / "out", "a" * 40)
            (root / "valid.bin").write_bytes(b"x")
            with self.assertRaises(ValueError):
                package(root / "valid.bin", root / "out", "main")

if __name__ == "__main__":
    unittest.main()
