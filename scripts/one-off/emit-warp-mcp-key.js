"use strict";
// One-off helper for SP-20260519-007 release closure: read the local
// operator-only scripts/one-off/aiweb-pizza-mcp.cmd, extract the
// WARP_MCP_KEY value, and write it to stdout (and nothing else) so
// it can be piped into `gh secret set WARP_MCP_KEY -R cygaco/aiweb`
// without the value ever appearing in argv or in the transcript.
//
// The .cmd is gitignored and operator-local. This script is read-only
// against that file. No persistence; the value is in process memory
// only between read and pipe.
const fs = require("fs");
const path = require("path");

const cmdPath = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "one-off",
  "aiweb-pizza-mcp.cmd",
);

let content;
try {
  content = fs.readFileSync(cmdPath, "utf8");
} catch (err) {
  process.stderr.write(`cannot read .cmd: ${err.message}\n`);
  process.exit(1);
}

const m = content.match(/WARP_MCP_KEY=([^"\r\n]+)/);
if (!m) {
  process.stderr.write("no WARP_MCP_KEY assignment found in .cmd\n");
  process.exit(1);
}

const value = m[1].trim();
if (!value || value === "REPLACE_WITH_YOUR_KEY") {
  process.stderr.write(".cmd contains placeholder, not a real bearer\n");
  process.exit(1);
}

// stdout only; no trailing newline so gh receives the value verbatim.
process.stdout.write(value);
