@echo off
REM Wrapper for Claude Desktop to spawn the mcp-remote bridge to aiweb-mcp.
REM Avoids the Windows-path-with-space + quoted-header re-tokenization mess
REM that hits when Claude Desktop's cmd.exe /C launcher chains npx + an arg
REM containing both spaces and a colon. Here cmd.exe parses ONE command
REM line — these literals — and never re-quotes anything.

set "WARP_MCP_KEY=***REDACTED-LEAKED-WARP-MCP-KEY-ROTATED-2026-05-18***"
npx -y mcp-remote https://aiweb-mcp.fly.dev/mcp --header "Authorization: Bearer %WARP_MCP_KEY%"
