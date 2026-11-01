import copy
import json
import tempfile
import unittest
from pathlib import Path

from tinkertunnel.catalog import CatalogError, inspect, load_catalog, plan_install, search, validate


class CatalogTests(unittest.TestCase):
    def test_catalog_is_valid_and_has_both_frameworks(self):
        self.assertEqual(len(load_catalog()), 2)
        self.assertEqual({p["id"] for p in load_catalog()}, {"esp-idf", "swift"})

    def test_search_and_target_filter(self):
        self.assertEqual([r["id"] for r in search("ESP32", "linux", "arm64")], ["esp-idf"])
        self.assertEqual([r["id"] for r in search("swift", "macos", "arm64")], ["swift"])
        self.assertEqual(search("swift", "linux", "arm64"), [])

    def test_inspection_is_pinned(self):
        self.assertEqual(inspect("esp-idf", "5.5.6")["source"]["reference"], "v5.5.6")
        with self.assertRaises(CatalogError):
            inspect("esp-idf", "latest")

    def test_plan_never_modifies_host(self):
        plan = plan_install("esp-idf", "5.5.6", "linux", "arm64")
        self.assertEqual(plan["execution"], "NOT_IMPLEMENTED")
        self.assertEqual(plan["status"], "PLAN_ONLY_NO_HOST_CHANGES")
        self.assertTrue(plan["requires_user_approval_before_install"])
        self.assertNotIn("command", plan)
        with self.assertRaises(CatalogError):
            plan_install("esp-idf", "5.5.6", "macos", "arm64")

    def test_reject_arbitrary_command_and_unapproved_adapter(self):
        recipe = inspect("esp-idf", "5.5.6")
        bad = copy.deepcopy(recipe)
        bad["install"]["command"] = "curl ... | bash"
        with self.assertRaises(CatalogError):
            validate(bad)
        bad = copy.deepcopy(recipe)
        bad["install"]["adapter"] = "execute-script"
        with self.assertRaises(CatalogError):
            validate(bad)
        bad = copy.deepcopy(recipe)
        bad["install"]["approval"] = "none"
        with self.assertRaises(CatalogError):
            validate(bad)
        bad = copy.deepcopy(recipe)
        bad["install"]["strategy"] = "execute-now"
        with self.assertRaises(CatalogError):
            validate(bad)

    def test_reject_duplicate_recipe(self):
        recipe = inspect("swift", "6.1.2")
        with tempfile.TemporaryDirectory() as directory:
            for filename in ("first.json", "second.json"):
                (Path(directory) / filename).write_text(json.dumps(recipe))
            with self.assertRaises(CatalogError):
                load_catalog(Path(directory))

    def test_invalid_target_and_bad_schema(self):
        with self.assertRaises(CatalogError):
            search(os="windows")
        recipe = inspect("swift", "6.1.2")
        bad = copy.deepcopy(recipe)
        bad["schema_version"] = 2
        with self.assertRaises(CatalogError):
            validate(bad)


if __name__ == "__main__":
    unittest.main()
