"""Strict, read-only framework catalog and installation planning.

Catalog recipes are DATA, never shell scripts. No install/build/deploy execution
is exposed by this module; a separately authorized agent must implement adapters.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

CATALOG_DIR = Path(__file__).resolve().parents[1] / "catalog" / "frameworks"
_ID = re.compile(r"^[a-z][a-z0-9-]{1,63}$")
_VERSION = re.compile(r"^[0-9]+(?:\.[0-9]+){1,3}$")
_OS = {"linux", "macos"}
_ARCH = {"arm64", "x86_64"}
_ADAPTERS = {"esp-idf": "Check ESP-IDF version and installed toolchains",
             "swift": "Check Swift compiler and Apple SDK availability"}
_TOP_KEYS = {"schema_version", "id", "version", "title", "summary", "category",
             "tags", "platforms", "provides", "source", "install"}


class CatalogError(ValueError):
    """A recipe violates the curated marketplace contract."""


def _check(condition: bool, message: str) -> None:
    if not condition:
        raise CatalogError(message)


def validate(recipe: dict) -> dict:
    """Fail closed on unknown fields, commands, and unsupported adapters."""
    _check(isinstance(recipe, dict), "recipe must be an object")
    _check(set(recipe) == _TOP_KEYS, "recipe must have exactly the approved fields")
    _check(recipe["schema_version"] == 1, "unsupported schema_version")
    _check(isinstance(recipe["id"], str) and bool(_ID.fullmatch(recipe["id"])), "invalid id")
    _check(isinstance(recipe["version"], str) and bool(_VERSION.fullmatch(recipe["version"])), "invalid version")
    for key in ("title", "summary", "category"):
        _check(isinstance(recipe[key], str) and 0 < len(recipe[key]) <= 300, f"invalid {key}")
    _check(isinstance(recipe["tags"], list) and all(isinstance(t, str) and
           bool(_ID.fullmatch(t)) for t in recipe["tags"]), "invalid tags")
    platforms = recipe["platforms"]
    _check(isinstance(platforms, list) and bool(platforms), "platforms required")
    for platform in platforms:
        _check(isinstance(platform, dict) and set(platform) == {"os", "arch"} and
               isinstance(platform["os"], str) and platform["os"] in _OS and
               isinstance(platform["arch"], str) and platform["arch"] in _ARCH, "unsupported platform")
    _check(isinstance(recipe["provides"], list) and bool(recipe["provides"]) and
           all(isinstance(c, str) and bool(_ID.fullmatch(c)) for c in recipe["provides"]),
           "invalid capabilities")
    source = recipe["source"]
    _check(isinstance(source, dict) and set(source) == {"publisher", "url", "reference"} and
           all(isinstance(source[k], str) and 0 < len(source[k]) <= 300
               for k in source), "invalid source")
    _check(source["url"].startswith("https://"), "source must use HTTPS")
    install = recipe["install"]
    _check(isinstance(install, dict) and set(install) == {"adapter", "strategy", "approval"},
           "install must use a fixed adapter, not arbitrary commands")
    _check(isinstance(install["adapter"], str) and install["adapter"] in _ADAPTERS, "unknown installation adapter")
    _check(install["strategy"] == "verify-existing", "installer execution is not enabled")
    _check(install["approval"] == "required", "installation approval cannot be bypassed")
    return recipe


def load_catalog(directory: Path | None = None) -> list[dict]:
    root = directory if directory is not None else CATALOG_DIR
    recipes: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for path in sorted(root.glob("*.json")):
        try:
            recipe = validate(json.loads(path.read_text(encoding="utf-8")))
        except (ValueError, OSError) as exc:
            raise CatalogError(f"{path.name}: {exc}") from exc
        key = recipe["id"], recipe["version"]
        _check(key not in seen, f"duplicate recipe: {key}")
        seen.add(key)
        recipes.append(recipe)
    _check(bool(recipes), "framework catalog is empty or missing")
    return recipes


def search(query: str = "", os: str | None = None, arch: str | None = None) -> list[dict]:
    _check(isinstance(query, str) and len(query) <= 120, "query too long")
    _check(os is None or os in _OS, "unsupported OS")
    _check(arch is None or arch in _ARCH, "unsupported architecture")
    needle = query.casefold().strip()
    results = []
    for recipe in load_catalog():
        haystack = " ".join([recipe["id"], recipe["title"], recipe["summary"],
                              recipe["category"], *recipe["tags"]]).casefold()
        if needle and needle not in haystack:
            continue
        if not any((os is None or p["os"] == os) and
                   (arch is None or p["arch"] == arch) for p in recipe["platforms"]):
            continue
        results.append({"id": recipe["id"], "version": recipe["version"],
                        "title": recipe["title"], "summary": recipe["summary"],
                        "platforms": recipe["platforms"], "provides": recipe["provides"]})
    return results


def inspect(framework_id: str, version: str) -> dict:
    _check(isinstance(framework_id, str) and isinstance(version, str), "id/version required")
    for recipe in load_catalog():
        if recipe["id"] == framework_id and recipe["version"] == version:
            return recipe
    raise CatalogError(f"framework not found: {framework_id}@{version}")


def plan_install(framework_id: str, version: str, os: str, arch: str) -> dict:
    _check(os in _OS and arch in _ARCH, "unsupported target platform")
    recipe = inspect(framework_id, version)
    _check({"os": os, "arch": arch} in recipe["platforms"],
           "framework is not supported on the requested runner")
    return {
        "framework": f"{framework_id}@{version}",
        "platform": {"os": os, "arch": arch},
        "source": recipe["source"],
        "adapter": recipe["install"]["adapter"],
        "actions": ["Verify node identity and OS/architecture",
                    _ADAPTERS[recipe["install"]["adapter"]],
                    "Compare detected version with requested version",
                    "Return structured evidence and audit result"],
        "requires_user_approval_before_install": True,
        "execution": "NOT_IMPLEMENTED",
        "status": "PLAN_ONLY_NO_HOST_CHANGES",
        "note": "No installer commands, downloads, or host changes can run from this preview.",
    }


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Read-only TinkerTunnel framework marketplace")
    parser.add_argument("action", choices=("search", "inspect", "plan", "validate"))
    parser.add_argument("--query", default="")
    parser.add_argument("--id", default="")
    parser.add_argument("--version", default="")
    parser.add_argument("--os", default="")
    parser.add_argument("--arch", default="")
    args = parser.parse_args()
    if args.action == "search":
        result = search(args.query, args.os or None, args.arch or None)
    elif args.action == "inspect":
        result = inspect(args.id, args.version)
    elif args.action == "plan":
        result = plan_install(args.id, args.version, args.os, args.arch)
    else:
        result = {"validated": len(load_catalog()), "status": "ok"}
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
