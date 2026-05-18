#!/usr/bin/env node
/**
 * scripts/check-deployed-tools.js
 *
 * Post-deploy assertion for SP-20260517-005 (R-1 / S-2 / AC-2.*). Hits
 * the deployed MCP endpoint, runs `initialize` + `tools/list`, and
 * asserts the returned tools array equals exactly the canonical
 * whitelist. Exits 0 on match, 1 on mismatch. Appends a
 * `deploy.tools_list_snapshot` event (TR-4) to runtime/events.jsonl.
 *
 * Usage:
 *   node scripts/check-deployed-tools.js
 *   MCP_URL=https://example.fly.dev/mcp node scripts/check-deployed-tools.js
 *
 * Env:
 *   MCP_URL        — full /mcp endpoint URL (default: https://aiweb-mcp.fly.dev/mcp)
 *   WARP_MCP_KEY   — bearer token (required)
 *   COMMIT_SHA     — short SHA recorded in the trace event (optional)
 *
 * Designed for cron / GitHub Action canary use post-release.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MCP_URL = process.env.MCP_URL || "https://aiweb-mcp.fly.dev/mcp";
const BEARER = process.env.WARP_MCP_KEY;
const COMMIT_SHA = (process.env.COMMIT_SHA || "").slice(0, 12);
const EVENTS_LOG = path.join(process.cwd(), "runtime", "events.jsonl");

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
    // Fail-open on logging — don't mask the assertion result.
    process.stderr.write(`warn: could not append TR-4 event: ${err.message}\n`);
  }
}

function fail(reason, snapshot) {
  process.stderr.write(`check-deployed-tools: FAIL — ${reason}\n`);
  logEvent({
    ts: new Date().toISOString(),
    type: "deploy.tools_list_snapshot",
    deploy_target: MCP_URL,
    tools_listed: snapshot.tools_listed,
    commit_sha: COMMIT_SHA || null,
    assertion_result: "fail",
    unexpected_tools: snapshot.unexpected_tools,
    missing_tools: snapshot.missing_tools,
    reason,
  });
  process.exit(1);
}

function pass(toolsListed) {
  process.stdout.write(
    `check-deployed-tools: OK — ${toolsListed.length} tools, all expected.\n`,
  );
  logEvent({
    ts: new Date().toISOString(),
    type: "deploy.tools_list_snapshot",
    deploy_target: MCP_URL,
    tools_listed: toolsListed,
    commit_sha: COMMIT_SHA || null,
    assertion_result: "pass",
    unexpected_tools: [],
    missing_tools: [],
  });
  process.exit(0);
}

async function mcpRpc(method, params, sessionId) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (BEARER) headers["Authorization"] = `Bearer ${BEARER}`;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e9),
    method,
    params: params ?? {},
  });
  const res = await fetch(MCP_URL, { method: "POST", headers, body });
  const raw = await res.text();
  // Server emits SSE-framed JSON; strip `event: message\ndata: ` prefix when present.
  const m = raw.match(/data:\s*(\{[\s\S]*\})/);
  const json = m ? m[1] : raw;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `non-JSON response (status=${res.status}): ${raw.slice(0, 200)}`,
    );
  }
  if (parsed.error) {
    throw new Error(`${method} error: ${parsed.error.message}`);
  }
  return { result: parsed.result, status: res.status };
}

async function main() {
  if (!BEARER) {
    fail("WARP_MCP_KEY env var not set", {
      tools_listed: [],
      unexpected_tools: [],
      missing_tools: [],
    });
  }

  let init;
  try {
    init = await mcpRpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "check-deployed-tools", version: "0" },
    });
  } catch (err) {
    fail(`initialize failed: ${err.message}`, {
      tools_listed: [],
      unexpected_tools: [],
      missing_tools: [],
    });
  }
  // Session id is fine to fabricate for streamable-http; the server doesn't
  // require it for tools/list when initialize was just performed.
  const sessionId = "check-deployed-tools";

  let list;
  try {
    list = await mcpRpc("tools/list", {}, sessionId);
  } catch (err) {
    fail(`tools/list failed: ${err.message}`, {
      tools_listed: [],
      unexpected_tools: [],
      missing_tools: [],
    });
  }
  const tools = (list.result && list.result.tools) || [];
  const names = tools.map((t) => t.name).sort();
  const got = new Set(names);
  const unexpected = names.filter((n) => !EXPECTED_TOOLS.has(n));
  const missing = [...EXPECTED_TOOLS].filter((n) => !got.has(n));

  if (unexpected.length || missing.length) {
    fail(
      `tool set mismatch — unexpected=[${unexpected.join(",")}] missing=[${missing.join(",")}]`,
      {
        tools_listed: names,
        unexpected_tools: unexpected,
        missing_tools: missing,
      },
    );
  }
  pass(names);
}

main().catch((err) => {
  fail(`unexpected error: ${err.message}`, {
    tools_listed: [],
    unexpected_tools: [],
    missing_tools: [],
  });
});
