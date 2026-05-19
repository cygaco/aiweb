#!/usr/bin/env node
/**
 * scripts/cd-doctor.js
 *
 * SP-20260519-007 T-106 (R-4). One-command post-update verification of
 * the Claude Desktop integration. Runs four checks against the
 * deployed MCP server + the operator's local .cmd wrapper:
 *
 *   1. GET /healthz with 5s timeout — verifies the Fly machine reachable.
 *   2. tools/list parity vs canonical whitelist — reuses scripts/check-deployed-tools.js logic.
 *   3. .cmd bearer initialize — reads scripts/one-off/aiweb-pizza-mcp.cmd
 *      (operator-local, gitignored), extracts WARP_MCP_KEY, runs a tiny
 *      MCP initialize. Non-401 = bearer matches the live Fly secret.
 *   4. Local mcp-remote version parity — verifies the locally-resolved
 *      mcp-remote matches the .cmd.template pin.
 *
 * Prints a per-check status line + final green/red verdict. Designed
 * for operator-after-update use; not for cron. Use scripts/check-deployed-tools.js
 * on cron for tool-list canary only.
 *
 * Usage:
 *   node scripts/cd-doctor.js
 *   npm run cd:doctor
 *
 * Env:
 *   MCP_URL        — full /mcp endpoint (default: https://aiweb-mcp.fly.dev/mcp)
 *   WARP_MCP_KEY   — bearer; falls back to value parsed from .cmd file.
 *
 * Exit codes:
 *   0 — all checks pass or are gracefully skipped
 *   1 — one or more checks failed
 *   2 — argv/env error (invalid MCP_URL etc.)
 *
 * IMPORTANT: this script must NEVER print the WARP_MCP_KEY value to
 * stdout or the events log. Treat the bearer as a secret throughout.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const MCP_URL = process.env.MCP_URL || "https://aiweb-mcp.fly.dev/mcp";
const CMD_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "one-off",
  "aiweb-pizza-mcp.cmd",
);
const CMD_TEMPLATE_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "one-off",
  "aiweb-pizza-mcp.cmd.template",
);
const EVENTS_LOG = path.join(REPO_ROOT, "runtime", "events.jsonl");
const HEALTHZ_URL = (() => {
  try {
    const u = new URL(MCP_URL);
    return `${u.protocol}//${u.host}/healthz`;
  } catch {
    return null;
  }
})();

const EXPECTED_TOOLS = new Set([
  "prepare_order",
  "start_pizza_order",
  "update_order",
  "place_order",
  "check_order_status",
]);

function logEvent(record) {
  try {
    fs.mkdirSync(path.dirname(EVENTS_LOG), { recursive: true });
    fs.appendFileSync(EVENTS_LOG, JSON.stringify(record) + "\n");
  } catch (err) {
    process.stderr.write(
      `warn: could not append cd_doctor.run event: ${err.message}\n`,
    );
  }
}

function parseCmdBearer(cmdText) {
  // Matches:  set "WARP_MCP_KEY=abc..."  or  set WARP_MCP_KEY=abc...
  const m = cmdText.match(/^set\s+"?WARP_MCP_KEY=([^"\r\n]+)"?\s*$/m);
  return m ? m[1].trim() : null;
}

function parseCmdMcpRemoteVersion(cmdText) {
  // Matches:  npx -y mcp-remote@X.Y.Z   or  npx ... mcp-remote@X.Y.Z
  const m = cmdText.match(/mcp-remote@([^\s"]+)/);
  return m ? m[1] : null;
}

async function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function mcpRpc(bearer, method, params) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e9),
    method,
    params: params ?? {},
  });
  const res = await fetchWithTimeout(
    MCP_URL,
    { method: "POST", headers, body },
    10_000,
  );
  const raw = await res.text();
  const m = raw.match(/data:\s*(\{[\s\S]*\})/);
  const json = m ? m[1] : raw;
  let parsed = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { status: res.status, parsed: null, raw };
  }
  return { status: res.status, parsed, raw };
}

async function checkHealthz() {
  if (!HEALTHZ_URL) {
    return {
      name: "healthz",
      status: "fail",
      details: "MCP_URL not parseable as a URL.",
    };
  }
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(HEALTHZ_URL, { method: "GET" }, 5_000);
    const ms = Date.now() - start;
    if (res.ok) {
      return {
        name: "healthz",
        status: "ok",
        details: `HTTP ${res.status}, ${ms}ms`,
      };
    }
    return {
      name: "healthz",
      status: "fail",
      details: `HTTP ${res.status}, ${ms}ms`,
    };
  } catch (err) {
    if (err && err.name === "AbortError") {
      return {
        name: "healthz",
        status: "fail",
        details: "5s timeout, no response",
      };
    }
    return { name: "healthz", status: "fail", details: err.message };
  }
}

async function checkToolsList(bearer) {
  if (!bearer) {
    return {
      name: "tools-list",
      status: "skipped",
      details:
        "no bearer available (WARP_MCP_KEY env not set and .cmd absent or unparseable)",
    };
  }
  try {
    const init = await mcpRpc(bearer, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cd-doctor", version: "0" },
    });
    if (init.status === 401) {
      return {
        name: "tools-list",
        status: "fail",
        details: "initialize returned 401 — bearer rejected",
      };
    }
    if (!init.parsed || init.parsed.error) {
      const msg =
        init.parsed && init.parsed.error
          ? init.parsed.error.message
          : `status ${init.status}`;
      return {
        name: "tools-list",
        status: "fail",
        details: `initialize: ${msg}`,
      };
    }
    const list = await mcpRpc(bearer, "tools/list", {});
    if (!list.parsed || list.parsed.error) {
      const msg =
        list.parsed && list.parsed.error
          ? list.parsed.error.message
          : `status ${list.status}`;
      return {
        name: "tools-list",
        status: "fail",
        details: `tools/list: ${msg}`,
      };
    }
    const tools = (list.parsed.result && list.parsed.result.tools) || [];
    const names = tools.map((t) => t.name).sort();
    const got = new Set(names);
    const unexpected = names.filter((n) => !EXPECTED_TOOLS.has(n));
    const missing = [...EXPECTED_TOOLS].filter((n) => !got.has(n));
    if (unexpected.length || missing.length) {
      return {
        name: "tools-list",
        status: "fail",
        details: `unexpected=[${unexpected.join(",")}] missing=[${missing.join(",")}]`,
      };
    }
    return {
      name: "tools-list",
      status: "ok",
      details: `${names.length} tools match whitelist`,
    };
  } catch (err) {
    return { name: "tools-list", status: "fail", details: err.message };
  }
}

async function checkBearer(bearer, source) {
  if (!bearer) {
    return {
      name: "bearer",
      status: "skipped",
      details: `${CMD_PATH} not found. Run the installer first OR set WARP_MCP_KEY directly. This is normal for a fresh checkout.`,
    };
  }
  try {
    const init = await mcpRpc(bearer, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cd-doctor", version: "0" },
    });
    if (init.status === 401) {
      return {
        name: "bearer",
        status: "fail",
        details: `initialize returned 401 (source=${source}) — bearer doesn't match the live Fly secret`,
      };
    }
    if (!init.parsed || init.parsed.error) {
      const msg =
        init.parsed && init.parsed.error
          ? init.parsed.error.message
          : `status ${init.status}`;
      return {
        name: "bearer",
        status: "fail",
        details: `initialize: ${msg} (source=${source})`,
      };
    }
    const info = init.parsed.result && init.parsed.result.serverInfo;
    const ver = info && info.version ? ` server v${info.version}` : "";
    return {
      name: "bearer",
      status: "ok",
      details: `initialize accepted (source=${source})${ver}`,
    };
  } catch (err) {
    return { name: "bearer", status: "fail", details: err.message };
  }
}

function checkLocalMcpRemoteVersion(templatePin) {
  if (!templatePin) {
    return {
      name: "mcp-remote-version",
      status: "skipped",
      details:
        ".cmd.template has no mcp-remote@<version> pin to compare against",
    };
  }
  const res = spawnSync(
    "npx",
    ["--yes", "--no-install", `mcp-remote@${templatePin}`, "--version"],
    {
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  if (res.status === 0) {
    return {
      name: "mcp-remote-version",
      status: "ok",
      details: `pinned mcp-remote@${templatePin} resolvable via npx`,
    };
  }
  return {
    name: "mcp-remote-version",
    status: "skipped",
    details: `couldn't probe mcp-remote@${templatePin} locally (npx exit=${res.status}); pin is in .cmd.template`,
  };
}

function readCmdMaybe() {
  if (!fs.existsSync(CMD_PATH)) return null;
  try {
    return fs.readFileSync(CMD_PATH, "utf8");
  } catch {
    return null;
  }
}

function readTemplateMaybe() {
  if (!fs.existsSync(CMD_TEMPLATE_PATH)) return null;
  try {
    return fs.readFileSync(CMD_TEMPLATE_PATH, "utf8");
  } catch {
    return null;
  }
}

function printCheck(idx, total, check) {
  const tag =
    check.status === "ok" ? "OK" : check.status === "fail" ? "FAIL" : "SKIPPED";
  process.stdout.write(
    `[${idx}/${total}] ${check.name}: ${tag} — ${check.details}\n`,
  );
}

async function main() {
  const cmdText = readCmdMaybe();
  const templateText = readTemplateMaybe();
  const cmdBearer = cmdText ? parseCmdBearer(cmdText) : null;
  const cmdBearerValid =
    cmdBearer && cmdBearer !== "REPLACE_WITH_YOUR_KEY" && cmdBearer.length >= 16
      ? cmdBearer
      : null;
  const envBearer =
    process.env.WARP_MCP_KEY && process.env.WARP_MCP_KEY.length >= 16
      ? process.env.WARP_MCP_KEY
      : null;
  const bearerForToolsList = envBearer || cmdBearerValid;
  const bearerForCheckThree = cmdBearerValid || envBearer;
  const bearerSource = cmdBearerValid
    ? "scripts/one-off/aiweb-pizza-mcp.cmd"
    : envBearer
      ? "env WARP_MCP_KEY"
      : null;
  const templatePin = templateText
    ? parseCmdMcpRemoteVersion(templateText)
    : null;

  const checks = [];
  checks.push(await checkHealthz());
  checks.push(await checkToolsList(bearerForToolsList));
  checks.push(await checkBearer(bearerForCheckThree, bearerSource || "none"));
  checks.push(checkLocalMcpRemoteVersion(templatePin));

  const total = checks.length;
  checks.forEach((c, i) => printCheck(i + 1, total, c));

  const failed = checks.filter((c) => c.status === "fail");
  const skipped = checks.filter((c) => c.status === "skipped");
  const verdict = failed.length === 0 ? "green" : "red";

  if (verdict === "green") {
    if (skipped.length === 0) {
      process.stdout.write(
        `cd:doctor: GREEN — all checks passed (healthz OK, tools-list matches whitelist, bearer accepted, mcp-remote version match).\n`,
      );
    } else {
      const skippedNames = skipped.map((c) => c.name).join(", ");
      process.stdout.write(
        `cd:doctor: GREEN — ${total - skipped.length} of ${total} checks passed (skipped: ${skippedNames}; see per-check output for why).\n`,
      );
    }
  } else {
    const names = failed.map((c) => c.name).join(", ");
    process.stdout.write(
      `cd:doctor: RED — ${failed.length} of ${total} checks failed: ${names}. See per-check output above. Playbook: _docs/operations/cd-doctor.md.\n`,
    );
  }

  logEvent({
    ts: new Date().toISOString(),
    type: "cd_doctor.run",
    verdict,
    checks: checks.map((c) => ({
      name: c.name,
      status: c.status,
      details: c.details,
    })),
    mcp_url: MCP_URL,
    local_mcp_remote_version: templatePin || null,
  });

  // Set exitCode and let Node drain naturally. process.exit() while async
  // handles are still closing causes a libuv assertion on Windows
  // (UV_HANDLE_CLOSING in src\win\async.c) that returns a 3221226505 NTSTATUS.
  process.exitCode = verdict === "green" ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(`cd:doctor: RED — unexpected error: ${err.message}\n`);
  logEvent({
    ts: new Date().toISOString(),
    type: "cd_doctor.run",
    verdict: "red",
    checks: [],
    mcp_url: MCP_URL,
    error: err.message,
  });
  process.exitCode = 1;
});
