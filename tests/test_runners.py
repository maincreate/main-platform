import copy
import unittest
from tinkertunnel.catalog import CatalogError
from tinkertunnel.runners import inspect_profile, list_profiles, validate_profile


class RunnerProfilesTests(unittest.TestCase):
    def test_both_profiles_pass_validation(self):
        self.assertEqual({p["id"] for p in list_profiles()},
                         {"esp32-linux-arm64", "apple-macos"})

    def test_no_flash_and_single_builder_at_once(self):
        for profile in list_profiles():
            self.assertFalse(profile["device_access"])
            self.assertEqual(profile["default_concurrency"], 1)

    def test_reject_privilege_and_unknown_framework(self):
        example = inspect_profile("esp32-linux-arm64")
        bad = copy.deepcopy(example)
        bad["device_access"] = True
        with self.assertRaises(CatalogError):
            validate_profile(bad)
        bad = copy.deepcopy(example)
        bad["frameworks"] = ["esp-idf@latest"]
        with self.assertRaises(CatalogError):
            validate_profile(bad)
        bad = copy.deepcopy(example)
        bad["default_concurrency"] = 8
        with self.assertRaises(CatalogError):
            validate_profile(bad)

    def test_cross_platform_mismatch(self):
        bad = copy.deepcopy(inspect_profile("apple-macos"))
        bad["frameworks"] = ["esp-idf@5.5.6"]
        with self.assertRaises(CatalogError):
            validate_profile(bad)


if __name__ == "__main__":
    unittest.main()
