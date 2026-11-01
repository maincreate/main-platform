# TinkerTunnel

A secure, ChatGPT-operable framework marketplace and device/build execution fabric.

**Status:** foundation preview; not deployed. Current implementation provides
curated framework discovery, inspection and read-only installation planning,
plus an optional *local* MCP server. Remote ChatGPT OAuth, authorized installers,
GitHub job dispatch and device operations are not yet implemented.

## Start here

- [Marketplace + multi-project runner plan](docs/marketplace-and-runners.md)
- [Existing MVP gateway / firmware architecture](docs/mvp-architecture.md)
- [Artifact contract proof of concept](poc/README.md)

### Test without installing dependencies

```bash
python -m tinkertunnel.catalog validate
python -m tinkertunnel.catalog search --query esp32 --os linux --arch arm64
python -m tinkertunnel.catalog inspect --id esp-idf --version 5.5.6
python -m tinkertunnel.catalog plan --id esp-idf --version 5.5.6 --os linux --arch arm64
python -m unittest discover -s tests -v
```

### Optional local MCP preview

With Python 3.11 or later:

```bash
python -m pip install -e '.[mcp]'
python -m tinkertunnel.mcp_server
```

Connect an MCP-compatible local stdio client. Exposed tools:
`framework_search`, `framework_inspect`, `framework_install_plan`.
No remote HTTP endpoint or privileged tools are enabled.

The catalog deliberately rejects arbitrary commands and scripts. Existing
Waymarker build and USB flashing infrastructure remains unchanged.
