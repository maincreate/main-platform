# Project requirements and compatible builders

Main{Create} does not require manual project imports. It periodically synchronizes the repositories of the selected GitHub App installation (up to the existing 500-repository limit), then checks the default branches for build requirements. The controller checks a bounded batch of 25 repositories at a time, with concurrency 3, and retries unknown/failed scans. GitHub metadata and manifest reads require access to the repository through the connected GitHub App.

## Detection hierarchy

1. **Explicit, versioned project manifest** at `.tinkertunnel/project.json` (authoritative). This optional metadata is the only way to express exact machine and SDK constraints that cannot be inferred reliably from CI. Example:

```json
{
  "schema": 1,
  "targets": [
    {
      "os": "linux",
      "arch": "arm64",
      "tools": [
        {"name": "esp-idf", "version": "5.5.x"},
        {"name": "cmake"}
      ]
    }
  ]
}
```

2. **GitHub Actions workflow inference** if no manifest exists: inspect up to six `.github/workflows/*.yml` files for literal `runs-on: ubuntu-*`, `runs-on: macos-*`, or `runs-on: windows-*` and literal `esp_idf_version`/`xcode-version` settings. A workflow that uses `xcodebuild` or identifies an iOS build implies Xcode even without a pinned version. A workflow that uses `idf.py` implies ESP-IDF, with a version constraint only when explicitly declared.
3. **Unknown** when no reliable requirements are discoverable. We never silently assume that every repository supports Linux or that the current runner happens to have the correct SDK.

For an iOS application, use `{"schema":1,"targets":[{"os":"macos","tools":[{"name":"xcode","version":">=16.4"}]}]}` (adjust the version to the project's actual minimum). This requires a Mac with a verified Xcode package.

## Compatibility and notifications

Targets are alternatives (OR). A compatible machine must satisfy **all** requirements inside one target: OS, optional architecture, and every listed tool and version constraint. Versions support exact `5.5.6`, prefix/minor `5.5.x`, or minimum `>=16.4`. The SDK comes from the Host Service's reported version, not merely from a suggested label.

Only currently reporting managed hosts with an associated GitHub runner count as potential matches. Compatibility is reevaluated when the portal reads the project inventory, including after the host reports its packages or reconnects. The check does not assert a successful build or an independently verified GitHub runner-online status.

The Projects page and Overview display a **Needs compatible builder** notice for active, classified projects with no match. Unknown requirements are labeled separately and never misreported as incompatible. Archived repositories are automatically excluded from notices. **Ignore compatibility alerts** suppresses a project's notice without deleting it from inventory; the user can resume alerts later. Preferences are stored outside the GitHub repository inventory, so normal GitHub synchronization never erases them.

No automatic SDK installation, build dispatch, repository modification or provisioning is triggered by compatibility notifications.

### Implementation boundaries

- The connected GitHub App must be allowed to read repository contents for automatic manifest/workflow inspection; repository Metadata read-only permissions alone will not work.
- Project inventory synchronizes automatically about hourly while the controller is online. Requirements refresh opportunistically in bounded batches, with a six-hour freshness window; the dashboard refreshes periodically.
- Workflow parsing is deliberately conservative rather than executing or evaluating YAML expressions. Matrix expressions and implicit SDK versions may be classified **unknown**. Use a small manifest to specify constraints explicitly rather than guessing.
- The current Host Service supports Linux ARM64 and basic package reporting. Additional platform-specific package inventory and richer SDK version discovery are follow-on adapters.
- Alerts in this version are **in-app notices**, not push or email notifications.
