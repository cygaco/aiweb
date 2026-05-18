#!/usr/bin/env node
/**
 * golden-path.js — Autonomous golden-path testing harness
 *
 * Sprint: SP-20260514-002
 * Tickets: T-070 (driver), T-071 (MCP stdio surface), T-072 (A2A surface),
 *          T-073 (scenario loader), T-075 (events snapshot), T-077 (trace/report),
 *          T-078 (ensureBuild), T-079 (test:golden script)
 * Sprint: SP-20260514-004
 * Tickets: T-083 (A2A adapter wire-up — runA2AScenario rewrite)
 *
 * Three-layer Bland guard:
 *   Layer 1: BLAND_API_KEY="" (env, set here before spawning children)
 *   Layer 2: BLAND_HARNESS_MODE=1 (source short-circuit in bland.ts)
 *   Layer 3: sim_ prefix assertion on every place_order callId (enforced here)
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { spawnSync, spawn } = require("child_process");
const http = require("http");
const { randomBytes, randomInt } = require("crypto");
const {
  adapt: adaptA2AIntent,
  AdapterMissingFieldsError,
} = require("./adapters/a2a-intent");

// ─────────────────────────────────────────────────────────────
// Constants & paths
// ─────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const DIST_STDIO = path.join(ROOT, "dist/stdio.js");
const DIST_HTTP = path.join(ROOT, "dist/http.js");
const EVENTS_FILE = path.join(ROOT, "runtime/events.jsonl");
const SCENARIOS_DIR = path.join(ROOT, "tests/golden-path-harness/scripts");
const RUNTIME_GOLDEN = path.join(ROOT, "runtime/golden-runs");
const FIRST_RUN_REPORT_DIR = path.join(
  ROOT,
  ".claude/project/sprint/requirements/SP-20260514-002/reports",
);

const VALID_SURFACES = ["mcp-stdio", "a2a-jsonrpc", "all"];
const VALID_SCENARIOS = [
  "pizza-only",
  "pizza-plus-side",
  "pizza-plus-drink",
  // SP-20260517-005 / S-11 / T-098. New verdict-gate regression case.
  // Drives a fixture-injected places-style restaurant + INCLUDE_TEST_RESTAURANTS=false
  // so test_vlad is suppressed and the all-unknown gate fires.
  "fallback-discovery",
  "all",
];

// ─────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────

function parseCLI(argv) {
  const args = argv.slice(2);
  const opts = {
    surface: "all",
    scenario: "all",
    firstRunOnly: false,
    reportDir: null,
    noBuild: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      opts.help = true;
    } else if (a === "--surface") {
      opts.surface = args[++i];
    } else if (a === "--scenario") {
      opts.scenario = args[++i];
    } else if (a === "--first-run-only") {
      opts.firstRunOnly = true;
    } else if (a === "--report-dir") {
      opts.reportDir = args[++i];
    } else if (a === "--no-build") {
      opts.noBuild = true;
    } else if (a === "--verbose") {
      opts.verbose = true;
    } else {
      console.error(`Unknown flag: ${a}`);
      printUsage();
      process.exit(2);
    }
  }

  return opts;
}

function printUsage() {
  console.log(
    `Usage: node scripts/harness/golden-path.js [options]

Options:
  --surface <surface>    mcp-stdio | a2a-jsonrpc | all  (default: all)
  --scenario <scenario>  pizza-only | pizza-plus-side | pizza-plus-drink | fallback-discovery | all  (default: all)
  --first-run-only       Write report to sprint requirements dir (committed)
  --report-dir <path>    Override report directory
  --no-build             Skip build pre-flight (dist/ used as-is)
  --verbose              Stream child stderr live
  --help                 Print this message
`,
  );
}

// ─────────────────────────────────────────────────────────────
// Build pre-flight (T-078)
// ─────────────────────────────────────────────────────────────

function ensureBuild(opts) {
  if (opts.noBuild) return;

  // Check if dist files exist
  const distMissing = !fs.existsSync(DIST_STDIO) || !fs.existsSync(DIST_HTTP);

  let needsBuild = distMissing;

  if (!distMissing) {
    // Check if any src/**/*.ts is newer than newest dist/**/*.js
    const srcTsFiles = walkExt(path.join(ROOT, "src"), ".ts");
    const distJsFiles = walkExt(path.join(ROOT, "dist"), ".js");
    if (srcTsFiles.length > 0 && distJsFiles.length > 0) {
      const latestSrc = Math.max(
        ...srcTsFiles.map((f) => fs.statSync(f).mtimeMs),
      );
      const latestDist = Math.max(
        ...distJsFiles.map((f) => fs.statSync(f).mtimeMs),
      );
      if (latestSrc > latestDist) needsBuild = true;
    } else if (srcTsFiles.length > 0 && distJsFiles.length === 0) {
      needsBuild = true;
    }
  }

  if (!needsBuild) return;

  console.log(
    "  build pre-flight: dist/ is stale or missing — running `npm run build`...",
  );
  const result = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
  });

  if (result.status !== 0) {
    console.error("  build pre-flight: FAILED — see stderr above");
    process.exit(1);
  }
  console.log("  build pre-flight: ok");
}

function walkExt(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkExt(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// Scenario loader (T-073)
// ─────────────────────────────────────────────────────────────

function loadScenarios(scenarioArg) {
  const names =
    scenarioArg === "all"
      ? [
          "pizza-only",
          "pizza-plus-side",
          "pizza-plus-drink",
          // SP-20260517-005 / S-11 / T-098 — regression-protect the
          // new verdict gate alongside the existing golden paths.
          "fallback-discovery",
        ]
      : [scenarioArg];

  const loaded = [];
  for (const name of names) {
    const file = path.join(SCENARIOS_DIR, `${name}.json`);
    if (!fs.existsSync(file)) {
      console.error(`Scenario file not found: ${file}`);
      process.exit(1);
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`Scenario ${name} failed to parse JSON: ${e.message}`);
      process.exit(1);
    }
    // Validate step count. SP-20260517-005 / T-098 — lowered the floor
    // from 3 to 1 so the fallback-discovery scenario can stop at
    // start_pizza_order (the gate's whole point is that the flow
    // REFUSES to proceed to cart-show / prepare_order / place_order).
    if (!parsed.steps || parsed.steps.length < 1 || parsed.steps.length > 12) {
      console.error(
        `Scenario ${name}: step count must be 1..12 (got ${parsed.steps?.length})`,
      );
      process.exit(1);
    }
    loaded.push(parsed);
  }
  return loaded;
}

// ─────────────────────────────────────────────────────────────
// JSONPath capture resolver (simple $.field.sub syntax)
// ─────────────────────────────────────────────────────────────

function resolveCapture(path_expr, obj) {
  if (!path_expr.startsWith("$.")) return undefined;
  const parts = path_expr.slice(2).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function interpolateArgs(args, capturedVars) {
  const str = JSON.stringify(args);
  const replaced = str.replace(/"\$\{(\w+)\}"/g, (_, key) => {
    const val = capturedVars[key];
    if (val === undefined) {
      throw new Error(`Missing captured var: ${key}`);
    }
    return JSON.stringify(val);
  });
  return JSON.parse(replaced);
}

// ─────────────────────────────────────────────────────────────
// Assertion runner
// ─────────────────────────────────────────────────────────────

function runAssertions(assertions, responseObj, traceStep) {
  const failures = [];

  for (const assertion of assertions || []) {
    let ok = false;
    let detail = "";

    switch (assertion.kind) {
      case "status_not_error": {
        const s = responseObj?.status;
        ok = s !== "error";
        if (!ok)
          detail = `status === "error" (got: ${JSON.stringify(responseObj)})`;
        break;
      }
      case "restaurant_id_present": {
        // Check primaryRestaurant.id or restaurants[].id
        const targetId = assertion.value;
        const primary = responseObj?.primaryRestaurant?.id;
        const inList = (responseObj?.restaurants || []).some(
          (r) => r.id === targetId,
        );
        ok = primary === targetId || inList;
        if (!ok) detail = `restaurant_id "${targetId}" not found in response`;
        break;
      }
      case "callid_sim_prefix": {
        const callId = responseObj?.callId || responseObj?.call_id;
        ok = typeof callId === "string" && callId.startsWith("sim_");
        if (!ok) {
          // LAYER 3 violation — hard fail
          const msg = `>>> REDTEAM VIOLATION: place_order returned non-sim callId "${callId}". Aborting before status poll.
>>> The three-layer Bland guard failed. See src/connectors/bland.ts BLAND_HARNESS_MODE short-circuit.`;
          console.error(msg);
          // Write redteam_violation to trace
          if (traceStep) traceStep.redteam_violation = true;
          process.exit(1);
        }
        break;
      }
      case "json_path_truthy": {
        const val = resolveCapture(assertion.value, responseObj);
        ok = !!val;
        if (!ok)
          detail = `${assertion.value} is not truthy (got: ${JSON.stringify(val)})`;
        break;
      }
      case "json_path_typeof": {
        const val = resolveCapture(assertion.value, responseObj);
        ok = typeof val === assertion.type;
        if (!ok)
          detail = `typeof ${assertion.value} !== "${assertion.type}" (got: ${typeof val}, value: ${JSON.stringify(val)})`;
        break;
      }
      case "field_contains": {
        // check if a field path contains a string
        const val = resolveCapture(
          assertion.path || assertion.value,
          responseObj,
        );
        ok =
          typeof val === "string" &&
          val.toLowerCase().includes(assertion.contains.toLowerCase());
        if (!ok)
          detail = `${assertion.value || assertion.path} does not contain "${assertion.contains}"`;
        break;
      }
      case "json_path_equals": {
        // SP-20260517-005 / S-11 / T-098. Strict equality.
        const val = resolveCapture(assertion.value, responseObj);
        ok = val === assertion.expected;
        if (!ok)
          detail = `${assertion.value} !== ${JSON.stringify(assertion.expected)} (got: ${JSON.stringify(val)})`;
        break;
      }
      case "json_path_undefined": {
        // SP-20260517-005 / S-11 / T-098. Asserts a field is absent
        // (undefined OR null). Used for "no_suggested_order" on the
        // fallback_discovery scenario.
        const val = resolveCapture(assertion.value, responseObj);
        ok = val === undefined || val === null;
        if (!ok)
          detail = `${assertion.value} expected undefined/null (got: ${JSON.stringify(val)})`;
        break;
      }
      default:
        failures.push({
          name: assertion.name,
          ok: false,
          detail: `Unknown assertion kind: ${assertion.kind}`,
        });
        continue;
    }

    if (!ok) {
      failures.push({ name: assertion.name, ok: false, detail });
    }
  }

  return failures;
}

// ─────────────────────────────────────────────────────────────
// Events JSONL snapshot + tail assertion (T-075)
// ─────────────────────────────────────────────────────────────

function snapshotEventsSize() {
  const eventsFile = process.env.COMPATIBILITY_EVENTS_FILE || EVENTS_FILE;
  if (!fs.existsSync(eventsFile)) {
    // Create empty so tail works
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.writeFileSync(eventsFile, "");
  }
  return { file: eventsFile, size: fs.statSync(eventsFile).size };
}

function readEventsTail(snapshot) {
  const { file, size: preSize } = snapshot;
  if (!fs.existsSync(file)) return [];
  const buf = fs.readFileSync(file);
  if (buf.length <= preSize) return [];
  const tail = buf.slice(preSize).toString("utf8");
  const lines = tail.split("\n").filter((l) => l.trim().length > 0);
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch (e) {
      // Hard fail on parse error per AC-8.3
      throw new Error(`events.jsonl tail line failed JSON.parse: ${line}`);
    }
  }
  return parsed;
}

function runEventsAssertions(eventsAssertions, tailEvents) {
  const failures = [];
  for (const ea of eventsAssertions || []) {
    const matching = tailEvents.filter((e) => e.cat === ea.cat);
    if (ea.min_count !== undefined && matching.length < ea.min_count) {
      failures.push({
        name: ea.name,
        ok: false,
        detail: `cat="${ea.cat}" min_count=${ea.min_count} but found ${matching.length}`,
      });
    }
    if (ea.max_count !== undefined && matching.length > ea.max_count) {
      failures.push({
        name: ea.name,
        ok: false,
        detail: `cat="${ea.cat}" max_count=${ea.max_count} but found ${matching.length}`,
      });
    }
  }
  return failures;
}

// ─────────────────────────────────────────────────────────────
// JSONL trace writer (T-077)
// ─────────────────────────────────────────────────────────────

function writeTraceLine(traceFile, obj) {
  fs.mkdirSync(path.dirname(traceFile), { recursive: true });
  fs.appendFileSync(traceFile, JSON.stringify(obj) + "\n");
}

// ─────────────────────────────────────────────────────────────
// MCP stdio surface runner (T-071)
// ─────────────────────────────────────────────────────────────

async function runMcpStdioScenario(scenario, env, opts, traceFile) {
  // Dynamic import of MCP SDK
  let Client, StdioClientTransport;
  try {
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ StdioClientTransport } =
      await import("@modelcontextprotocol/sdk/client/stdio.js"));
  } catch (e) {
    throw new Error(`MCP SDK import failed: ${e.message}`);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_STDIO],
    env: { ...process.env, ...env },
  });

  const client = new Client({ name: "harness", version: "1.0.0" });

  let child = null;
  // Capture reference to child process for cleanup
  transport.onclose = () => {};

  // Connect
  await client.connect(transport);

  // Derive child from transport internals (SDK exposes _process on StdioClientTransport)
  child = transport._process || null;

  const failures = [];
  const capturedVars = {};

  try {
    const result = await runScenarioSteps(
      scenario,
      capturedVars,
      async (tool, args) => {
        const resp = await client.callTool({ name: tool, arguments: args });
        // MCP returns content array; extract text
        const text = resp.content?.find((c) => c.type === "text")?.text;
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      },
      traceFile,
      "mcp-stdio",
    );

    failures.push(...result.failures);
  } finally {
    try {
      await client.close();
    } catch {}
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  return failures;
}

// ─────────────────────────────────────────────────────────────
// A2A JSON-RPC surface runner (T-072)
// ─────────────────────────────────────────────────────────────

function pickFreePort() {
  // Simple: start at 10000 + random offset
  return 10000 + Math.floor(Math.random() * 50000);
}

async function waitForHealth(port, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/healthz`, (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`health ${res.statusCode}`));
        });
        req.on("error", reject);
        req.setTimeout(500, () => {
          req.destroy();
          reject(new Error("timeout"));
        });
      });
      return true; // healthy
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

async function a2aJsonRpc(port, method, params, authKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: randomBytes(4).toString("hex"),
      method,
      params,
    });

    const req = http.request(
      {
        hostname: "localhost",
        port,
        path: "/a2a",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${authKey}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * runA2AScenario — T-083 (SP-20260514-004)
 *
 * Rewired to use the a2a-intent adapter. Instead of one message/send per
 * tool step (the old per-step approach that sent tool_call parts and silently
 * produced input-required without exercising real order intake), this function:
 *
 *   1. Calls adapt(scenario) to build a single A2A user-intent message.
 *   2. Dispatches exactly ONE message/send with the adapter's message payload.
 *   3. Reads the resulting Task from the JSON-RPC response.
 *   4. Asserts the final task state matches adapter.expectedTaskState within 5s.
 *
 * Failures are recorded in the existing failures[] shape (AC-2.2).
 * MCP stdio runner (runMcpStdioScenario + runScenarioSteps) is unchanged.
 */
async function runA2AScenario(scenario, env, opts, traceFile) {
  const port = pickFreePort();
  const authKey = "harness-test-key-" + randomBytes(8).toString("hex");

  const spawnEnv = {
    ...process.env,
    ...env,
    PORT: String(port),
    HOST: "127.0.0.1",
    WARP_MCP_KEY: authKey,
    PROFILE_ENCRYPTION_SECRET: randomBytes(32).toString("hex"),
  };

  const child = spawn(process.execPath, [DIST_HTTP], {
    env: spawnEnv,
    stdio: opts.verbose
      ? ["ignore", "inherit", "inherit"]
      : ["ignore", "ignore", "pipe"],
  });

  if (!opts.verbose && child.stderr) {
    child.stderr.on("data", () => {}); // drain
  }

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      // child failed — logged via failures[] below if health check failed
    }
  });

  const failures = [];

  try {
    // ── Step 1: Wait for health (5s budget) ─────────────────
    const healthy = await waitForHealth(port, 5000);
    if (!healthy) {
      failures.push({
        name: "health_check",
        ok: false,
        detail: `A2A server on port ${port} not healthy within 5s`,
      });
      return failures;
    }

    // ── Step 2: Build adapter payload (AC-2.1) ──────────────
    let adapterResult;
    try {
      adapterResult = adaptA2AIntent(scenario);
    } catch (e) {
      failures.push({
        name: "adapter_error",
        ok: false,
        detail: e.message,
      });
      return failures;
    }

    const { message, expectedTaskState } = adapterResult;

    // ── Step 3: Dispatch ONE message/send (AC-2.1) ──────────
    const t0 = Date.now();
    let rpcResp;
    try {
      rpcResp = await a2aJsonRpc(port, "message/send", { message }, authKey);
    } catch (e) {
      failures.push({
        name: "message_send_error",
        ok: false,
        detail: `message/send failed: ${e.message}`,
      });
      return failures;
    }

    const latencyMs = Date.now() - t0;

    // Trace the dispatch
    writeTraceLine(traceFile, {
      ts: new Date().toISOString(),
      surface: "a2a-jsonrpc",
      scenario: scenario.id,
      step: 0,
      tool: "message/send",
      args: { message_role: message.role, message_id: message.messageId },
      response: rpcResp,
      latency_ms: latencyMs,
      assertions: [],
    });

    // ── Step 4: Assert final task state (AC-2.2) ────────────
    // message/send (blocking=true default) waits for the executor to publish
    // a final event and returns the Task with its final status.
    const task = rpcResp?.result;
    const rpcError = rpcResp?.error;

    if (rpcError) {
      failures.push({
        name: "rpc_error",
        ok: false,
        detail: `JSON-RPC error: ${rpcError.code} — ${rpcError.message}`,
      });
      console.log(
        `  [00] message/send -> FAIL: rpc_error — ${rpcError.message} (${latencyMs}ms)`,
      );
      return failures;
    }

    const actualState = task?.status?.state;
    if (actualState !== expectedTaskState) {
      failures.push({
        name: "task_state_mismatch",
        ok: false,
        detail: `expected task state "${expectedTaskState}" but got "${actualState}" (task: ${JSON.stringify(task?.status)})`,
      });
      console.log(
        `  [00] message/send -> FAIL: task_state_mismatch — expected ${expectedTaskState}, got ${actualState} (${latencyMs}ms)`,
      );
    } else {
      console.log(
        `  [00] message/send -> ok, task state=${actualState} (${latencyMs}ms)`,
      );
    }
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    // Give it a moment to clean up
    await new Promise((r) => setTimeout(r, 100));
  }

  return failures;
}

// ─────────────────────────────────────────────────────────────
// Shared scenario step runner (used by both surfaces)
// ─────────────────────────────────────────────────────────────

async function runScenarioSteps(
  scenario,
  capturedVars,
  callTool,
  traceFile,
  surface,
) {
  const failures = [];

  for (let stepIdx = 0; stepIdx < scenario.steps.length; stepIdx++) {
    const step = scenario.steps[stepIdx];
    const stepNum = String(stepIdx).padStart(2, "0");

    // Interpolate captured vars into args
    let args;
    try {
      args = interpolateArgs(step.args || {}, capturedVars);
    } catch (e) {
      failures.push({
        name: `step_${stepNum}_arg_interpolation`,
        ok: false,
        detail: e.message,
      });
      break;
    }

    const t0 = Date.now();
    let responseObj = {};
    let callError = null;

    // Handle polling steps (e.g., check_order_status)
    if (step.polling) {
      const budget = step.polling.budget_ms || 12000;
      const until = step.polling.until; // e.g. "$.status === 'completed'"
      const deadline = Date.now() + budget;
      let polled = false;

      while (Date.now() < deadline) {
        try {
          responseObj = await callTool(step.tool, args);
        } catch (e) {
          callError = e;
          break;
        }

        // Evaluate until condition
        let done = false;
        try {
          // Simple eval of $.status === 'completed' style conditions
          const condStr = until.replace(/\$\.(\w+)/g, (_, key) => {
            const val = responseObj[key];
            return JSON.stringify(val);
          });
          done = Function(`"use strict"; return (${condStr})`)();
        } catch {}

        if (done) {
          polled = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (!polled && !callError) {
        failures.push({
          name: `step_${stepNum}_poll_timeout`,
          ok: false,
          detail: `${step.tool} polling did not satisfy "${until}" within ${budget}ms`,
        });
      }
    } else {
      try {
        responseObj = await callTool(step.tool, args);
      } catch (e) {
        callError = e;
      }
    }

    const latencyMs = Date.now() - t0;

    // Trace entry
    const traceEntry = {
      ts: new Date().toISOString(),
      surface,
      scenario: scenario.id,
      step: stepIdx,
      tool: step.tool,
      args,
      response: responseObj,
      latency_ms: latencyMs,
      assertions: [],
    };

    if (callError) {
      const f = {
        name: `step_${stepNum}_call_error`,
        ok: false,
        detail: callError.message,
      };
      failures.push(f);
      traceEntry.assertions.push({ name: f.name, ok: false, detail: f.detail });
      writeTraceLine(traceFile, traceEntry);
      console.log(
        `  [${stepNum}] ${step.tool} -> FAIL: ${f.name} — ${f.detail}`,
      );
      continue;
    }

    // Run assertions
    const stepFailures = runAssertions(
      step.assertions || [],
      responseObj,
      traceEntry,
    );
    traceEntry.assertions = (step.assertions || []).map((a) => {
      const failed = stepFailures.find((f) => f.name === a.name);
      return failed
        ? { name: a.name, ok: false, detail: failed.detail }
        : { name: a.name, ok: true };
    });

    // Capture variables
    if (step.capture) {
      for (const [varName, captureExpr] of Object.entries(step.capture)) {
        const val = resolveCapture(captureExpr, responseObj);
        if (val !== undefined) {
          capturedVars[varName] = val;
        }
      }
    }

    writeTraceLine(traceFile, traceEntry);

    if (stepFailures.length > 0) {
      for (const f of stepFailures) {
        console.log(
          `  [${stepNum}] ${step.tool} -> FAIL: ${f.name} — ${f.detail}`,
        );
        failures.push(f);
      }
    } else {
      console.log(`  [${stepNum}] ${step.tool} -> ok (${latencyMs}ms)`);
    }
  }

  return { failures };
}

// ─────────────────────────────────────────────────────────────
// Markdown report writer (T-077)
// ─────────────────────────────────────────────────────────────

function writeReport(reportFile, runs, iso, opts) {
  const totalMs = runs.reduce((s, r) => s + r.runtime_ms, 0);
  const failed = runs.filter((r) => r.verdict === "fail").length;
  const passed = runs.filter((r) => r.verdict === "pass").length;
  const verdict = failed === 0 ? "PASS" : "FAIL";
  const surfaces = [...new Set(runs.map((r) => r.surface))].join(", ");
  const scenarios = [...new Set(runs.map((r) => r.scenario))].join(", ");
  const traceFile = path.join(RUNTIME_GOLDEN, `${iso}.jsonl`);

  let md = `# Golden Path First Run — SP-20260514-002

**Date:** ${iso}
**Verdict:** ${verdict}
**Surfaces:** ${surfaces}
**Scenarios:** ${scenarios}
**Total runtime:** ${totalMs}ms
**Trace:** runtime/golden-runs/${iso}.jsonl (NOT committed — runtime/ is .gitignored)
**Guard layers active:**
1. BLAND_API_KEY="" (env)
2. BLAND_HARNESS_MODE=1 (source short-circuit)
3. "sim_" prefix assertion on every place_order response

`;

  for (const run of runs) {
    const runVerdict = run.verdict === "pass" ? "PASS" : "FAIL";
    md += `## ${run.surface}/${run.scenario}\n\n`;
    md += `**Verdict:** ${runVerdict} in ${run.runtime_ms}ms\n\n`;

    if (run.failures.length > 0) {
      md += `**Failures:**\n`;
      for (const f of run.failures) {
        md += `- \`${f.name}\`: ${f.detail || "(no detail)"}\n`;
      }
      md += "\n";
    } else {
      md += `All assertions passed.\n\n`;
    }
  }

  md += `---\n*Generated by scripts/harness/golden-path.js — SP-20260514-002*\n`;

  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, md);
}

// ─────────────────────────────────────────────────────────────
// Harness event writer (TR-5)
// ─────────────────────────────────────────────────────────────

function writeHarnessRunEvent(
  surface,
  scenarioId,
  verdict,
  runtimeMs,
  failures,
) {
  const eventsFile = process.env.COMPATIBILITY_EVENTS_FILE || EVENTS_FILE;
  try {
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    const line =
      JSON.stringify({
        id: `EVT-harness-${randomBytes(4).toString("hex")}`,
        ts: new Date().toISOString(),
        cat: "harness_run",
        actor: "harness",
        data: {
          surface,
          scenario: scenarioId,
          verdict,
          runtime_ms: runtimeMs,
          failures,
          guard_layers_active: 3,
        },
      }) + "\n";
    fs.appendFileSync(eventsFile, line);
  } catch {
    // fail-open
  }
}

// ─────────────────────────────────────────────────────────────
// Main entrypoint
// ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseCLI(process.argv);

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  // Validate --surface
  if (!VALID_SURFACES.includes(opts.surface)) {
    console.error(
      `Unknown surface: "${opts.surface}". Valid values: ${VALID_SURFACES.join(", ")}`,
    );
    process.exit(2);
  }

  // Validate --scenario
  if (!VALID_SCENARIOS.includes(opts.scenario)) {
    console.error(
      `Unknown scenario: "${opts.scenario}". Valid values: ${VALID_SCENARIOS.join(", ")}`,
    );
    process.exit(2);
  }

  // ── LAYER 1: Set env vars BEFORE spawning any child ──────
  process.env.BLAND_API_KEY = "";
  process.env.BLAND_HARNESS_MODE = "1";
  process.env.SIM_FAST_FORWARD_MS = "0";
  process.env.INCLUDE_TEST_RESTAURANTS = "true";
  // Generate once per harness run; propagated to children via harnessEnv below.
  const harnessTokenSecret = randomBytes(32).toString("hex");
  process.env.PROFILE_ENCRYPTION_SECRET = harnessTokenSecret;

  const harnessEnv = {
    BLAND_API_KEY: "",
    BLAND_HARNESS_MODE: "1",
    SIM_FAST_FORWARD_MS: "0",
    INCLUDE_TEST_RESTAURANTS: "true",
    PROFILE_ENCRYPTION_SECRET: harnessTokenSecret,
  };

  // Build pre-flight
  ensureBuild(opts);

  // Load scenarios
  const scenarios = loadScenarios(opts.scenario);

  // Determine surfaces to run
  const surfaces =
    opts.surface === "all" ? ["mcp-stdio", "a2a-jsonrpc"] : [opts.surface];

  // Trace file path
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const traceFile = path.join(RUNTIME_GOLDEN, `${iso}.jsonl`);
  fs.mkdirSync(RUNTIME_GOLDEN, { recursive: true });

  // Report dir
  let reportDir;
  if (opts.reportDir) {
    reportDir = opts.reportDir;
  } else if (opts.firstRunOnly) {
    reportDir = FIRST_RUN_REPORT_DIR;
  } else {
    reportDir = RUNTIME_GOLDEN;
  }
  const reportFile = path.join(
    reportDir,
    opts.firstRunOnly ? "first-run.md" : `${iso}-summary.md`,
  );

  const allRuns = [];
  let totalFailed = 0;

  // Print banner (C-1)
  for (const surface of surfaces) {
    for (const scenario of scenarios) {
      console.log(
        `\ngolden-path harness — surface=${surface} scenario=${scenario.id}`,
      );

      // SP-20260517-005 / T-098. Per-scenario env overrides (e.g. the
      // fallback-discovery scenario sets INCLUDE_TEST_RESTAURANTS=false
      // + TEST_RESTAURANTS_FIXTURE_FILE=<fixture>). Merge scenario-
      // declared envOverrides on top of the harness baseline before
      // spawning the child server.
      const scenarioEnv = {
        ...harnessEnv,
        ...(scenario.setup?.envOverrides ?? {}),
      };
      const envPrintable = Object.entries(scenarioEnv)
        .filter(([k]) => k !== "PROFILE_ENCRYPTION_SECRET")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      console.log(`  ${envPrintable}`);

      const eventsSnapshot = snapshotEventsSize();
      const t0 = Date.now();
      let failures = [];

      try {
        if (surface === "mcp-stdio") {
          failures = await runMcpStdioScenario(
            scenario,
            scenarioEnv,
            opts,
            traceFile,
          );
        } else if (surface === "a2a-jsonrpc") {
          failures = await runA2AScenario(
            scenario,
            scenarioEnv,
            opts,
            traceFile,
          );
        }
      } catch (e) {
        failures.push({
          name: "surface_runner_error",
          ok: false,
          detail: e.message,
        });
      }

      const runtimeMs = Date.now() - t0;

      // Events tail assertion
      // A2A surface uses a2a_events_assertions (may be empty/absent); the A2A
      // executor does not fire the MCP-specific events (compatibility, branch, etc.)
      // so reusing mcp events_assertions on A2A would always fail.
      try {
        const tailEvents = readEventsTail(eventsSnapshot);
        const evAssertions =
          surface === "a2a-jsonrpc"
            ? (scenario.a2a_events_assertions ?? [])
            : (scenario.events_assertions ?? []);
        const evFails = runEventsAssertions(evAssertions, tailEvents);
        failures.push(...evFails);
      } catch (e) {
        failures.push({
          name: "events_tail_parse_error",
          ok: false,
          detail: e.message,
        });
      }

      // Write verdict trace line
      const verdict = failures.length === 0 ? "pass" : "fail";
      writeTraceLine(traceFile, {
        ts: new Date().toISOString(),
        surface,
        scenario: scenario.id,
        verdict,
        failures,
      });

      // Write harness_run event (TR-5)
      writeHarnessRunEvent(surface, scenario.id, verdict, runtimeMs, failures);

      // C-3 per-scenario verdict
      if (failures.length === 0) {
        console.log(`  scenario ${scenario.id}: PASS in ${runtimeMs}ms`);
      } else {
        console.log(
          `  scenario ${scenario.id}: FAIL — ${failures.length} assertion(s) failed`,
        );
        totalFailed++;
      }

      allRuns.push({
        surface,
        scenario: scenario.id,
        verdict,
        runtime_ms: runtimeMs,
        failures,
      });
    }
  }

  // Write report
  writeReport(reportFile, allRuns, iso, opts);

  const totalMs = allRuns.reduce((s, r) => s + r.runtime_ms, 0);
  const passed = allRuns.filter((r) => r.verdict === "pass").length;

  // C-4 overall summary
  console.log(`\ngolden-path summary`);
  console.log(`  total scenarios: ${allRuns.length}`);
  console.log(`  passed:         ${passed}`);
  console.log(`  failed:         ${totalFailed}`);
  console.log(`  total runtime:  ${totalMs}ms`);
  console.log(`  trace:          ${traceFile}`);
  console.log(`  report:         ${reportFile}`);

  process.exit(totalFailed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness fatal error:", e.message);
  process.exit(1);
});
