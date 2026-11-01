"""Local-only MCP preview: marketplace discovery and zero-write planning.

Install, flash, network tunneling, and job dispatch are intentionally absent.
Do not expose this stdio server as an unauthenticated public HTTP endpoint.
"""
from mcp.server import MCPServer

from tinkertunnel.catalog import inspect, plan_install, search

mcp = MCPServer("TinkerTunnel Marketplace Preview")


@mcp.tool()
def framework_search(query: str = "", os: str | None = None,
                     arch: str | None = None) -> list[dict]:
    """Search vetted framework recipes by term, OS, and CPU architecture."""
    return search(query, os, arch)


@mcp.tool()
def framework_inspect(framework_id: str, version: str) -> dict:
    """Inspect a pinned marketplace framework recipe and its provenance."""
    return inspect(framework_id, version)


@mcp.tool()
def framework_install_plan(framework_id: str, version: str, os: str, arch: str) -> dict:
    """Preview prerequisites and fixed adapter checks. NEVER executes installation."""
    return plan_install(framework_id, version, os, arch)


if __name__ == "__main__":
    mcp.run(transport="stdio")
