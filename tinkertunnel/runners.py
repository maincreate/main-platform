"""Versioned runner-profile validation. Profiles are descriptions, not live nodes."""
from __future__ import annotations

import json
import re
from pathlib import Path

from tinkertunnel.catalog import CatalogError, inspect

PROFILE_DIR = Path(__file__).resolve().parents[1] / "catalog" / "runner-profiles"
_KEYS = {"schema_version", "id", "os", "arch", "runner_labels", "frameworks",
         "capabilities", "default_concurrency", "device_access"}
_ID = re.compile(r"^[a-z][a-z0-9-]{1,63}$")
_LABEL = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def validate_profile(profile: dict) -> dict:
    if not isinstance(profile, dict) or set(profile) != _KEYS:
        raise CatalogError("runner profile must have exactly the approved fields")
    if profile["schema_version"] != 1 or not isinstance(profile["id"], str) or not _ID.fullmatch(profile["id"]):
        raise CatalogError("invalid runner profile identity")
    if profile["os"] not in {"linux", "macos"} or profile["arch"] not in {"arm64", "x86_64"}:
        raise CatalogError("unsupported runner platform")
    labels = profile["runner_labels"]
    if not isinstance(labels, list) or not labels or any(
        not isinstance(label, str) or not _LABEL.fullmatch(label) for label in labels
    ) or len(labels) != len(set(labels)):
        raise CatalogError("invalid runner labels")
    if not isinstance(profile["frameworks"], list) or not profile["frameworks"]:
        raise CatalogError("runner must declare at least one pinned framework")
    for item in profile["frameworks"]:
        if not isinstance(item, str) or item.count("@") != 1:
            raise CatalogError("runner framework must use exact id@version")
        framework_id, version = item.split("@")
        recipe = inspect(framework_id, version)
        if {"os": profile["os"], "arch": profile["arch"]} not in recipe["platforms"]:
            raise CatalogError("framework incompatible with runner")
    capabilities = profile["capabilities"]
    if not isinstance(capabilities, list) or not capabilities or any(
        not isinstance(value, str) or not re.fullmatch(r"[a-z]+\.[a-z]+", value)
        for value in capabilities
    ):
        raise CatalogError("invalid runner capabilities")
    if type(profile["default_concurrency"]) is not int or profile["default_concurrency"] != 1:
        raise CatalogError("preview requires one job at a time")
    if profile["device_access"] is not False:
        raise CatalogError("build runners cannot access device flashing")
    return profile


def list_profiles() -> list[dict]:
    profiles = []
    seen = set()
    for path in sorted(PROFILE_DIR.glob("*.json")):
        try:
            profile = validate_profile(json.loads(path.read_text(encoding="utf-8")))
        except (ValueError, OSError) as exc:
            raise CatalogError(f"{path.name}: {exc}") from exc
        if profile["id"] in seen:
            raise CatalogError(f"duplicate runner profile {profile['id']}")
        seen.add(profile["id"])
        profiles.append(profile)
    return profiles


def inspect_profile(profile_id: str) -> dict:
    for profile in list_profiles():
        if profile["id"] == profile_id:
            return profile
    raise CatalogError(f"unknown runner profile: {profile_id}")
