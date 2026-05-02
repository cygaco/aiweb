#!/usr/bin/env node
/**
 * Agent Dashboard — human-readable view of the agent system state.
 *
 * Usage:
 *   node scripts/agent-dashboard.js              # full dashboard (auto-refreshes every 5s)
 *   node scripts/agent-dashboard.js --once       # single snapshot, no refresh
 *   node scripts/agent-dashboard.js --phase      # current phase only
 *   node scripts/agent-dashboard.js --bugs       # bug dataset only
 *   node scripts/agent-dashboard.js --log        # run log only
 *   node scripts/agent-dashboard.js --feature auth     # deep dive on one feature
 *   node scripts/agent-dashboard.js --ready      # features ready to build
 *   node scripts/agent-dashboard.js --deps       # dependency graph
 *   node scripts/agent-dashboard.js --files      # all features with file counts
 *   node scripts/agent-dashboard.js --timeline   # evolution + run log timeline
 *   node scripts/agent-dashboard.js --health     # system health checks
 *   node scripts/agent-dashboard.js --contracts  # SessionData producer/consumer flow
 *   node scripts/agent-dashboard.js --hygiene    # hygiene rule summary
 *   node scripts/agent-dashboard.js --agents     # full agent status view
 *   node scripts/agent-dashboard.js --worktrees  # active git worktrees (running agents)
 *   node scripts/agent-dashboard.js --json       # raw store.json to stdout
 */

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.resolve(
  __dirname,
  "..",
  ".claude",
  "agents",
  "store.json",
);

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_RED = "\x1b[41m";
const BG_GREEN = "\x1b[42m";
const BG_YELLOW = "\x1b[43m";
const BG_BLUE = "\x1b[44m";

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch (e) {
    console.error(`${RED}Cannot read store.json: ${e.message}${RESET}`);
    process.exit(1);
  }
}

function statusIcon(status) {
  const map = {
    not_started: `${DIM}○${RESET}`,
    in_progress: `${YELLOW}◐${RESET}`,
    built: `${BLUE}●${RESET}`,
    eval_pass: `${CYAN}✓${RESET}`,
    eval_fail: `${RED}✗${RESET}`,
    security_pass: `${GREEN}🛡${RESET}`,
    done: `${GREEN}✔${RESET}`,
  };
  return map[status] || `${DIM}?${RESET}`;
}

function statusColor(status) {
  const map = {
    not_started: DIM,
    in_progress: YELLOW,
    built: BLUE,
    eval_pass: CYAN,
    eval_fail: RED,
    security_pass: GREEN,
    done: GREEN,
  };
  return map[status] || RESET;
}

function pad(str, len) {
  return str.length >= len
    ? str.slice(0, len)
    : str + " ".repeat(len - str.length);
}

function timeSince(isoStr) {
  if (!isoStr) return "never";
  const ms = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Dependency Map ───────────────────────────────────────
// Hardcoded from TASK-MANIFEST.md — update if manifest changes.

const FOUNDATION_FEATURES = [
  "foundation-types",
  "foundation-constants",
  "foundation-storage",
  "foundation-validators",
  "foundation-pipeline",
  "foundation-api",
  "foundation-utils",
  "foundation-prompts",
  "foundation-ui",
  "foundation-layout",
];

const DEPENDENCY_MAP = {
  // Phase 0 — internal foundation deps (simplified: all depend on foundation-types)
  "foundation-types": [],
  "foundation-constants": ["foundation-types"],
  "foundation-storage": ["foundation-types"],
  "foundation-validators": ["foundation-types"],
  "foundation-pipeline": ["foundation-types"],
  "foundation-api": ["foundation-types", "foundation-validators"],
  "foundation-utils": ["foundation-types"],
  "foundation-prompts": ["foundation-types"],
  "foundation-ui": [],
  "foundation-layout": [
    "foundation-types",
    "foundation-constants",
    "foundation-ui",
  ],
  // Phase 1
  auth: FOUNDATION_FEATURES,
  rockets: FOUNDATION_FEATURES,
  // Phase 2
  onboarding: [...FOUNDATION_FEATURES, "auth", "rockets"],
  // Phase 2.5
  shell: [...FOUNDATION_FEATURES, "auth"],
  profile: [...FOUNDATION_FEATURES, "onboarding"],
  // Phase 3
  "market-research": [...FOUNDATION_FEATURES, "onboarding"],
  // Phase 4
  "deep-dive-qa": ["market-research"],
  "skills-curation": ["market-research"],
  competitiveness: FOUNDATION_FEATURES,
  // Phase 5
  "resume-generation": ["deep-dive-qa", "skills-curation", "rockets"],
  linkedin: ["deep-dive-qa", "skills-curation", "rockets"],
  // Phase 6
  extension: FOUNDATION_FEATURES,
  "auto-apply": ["resume-generation", "linkedin", "extension"],
  // Phase 7
  "deus-mechanicus": FOUNDATION_FEATURES,
};

function getPhaseNumber(name) {
  if (name.startsWith("foundation-")) return 0;
  if (name === "auth" || name === "rockets") return 1;
  if (name === "onboarding") return 2;
  if (name === "shell" || name === "profile") return 2.5;
  if (name === "market-research") return 3;
  if (["deep-dive-qa", "skills-curation", "competitiveness"].includes(name))
    return 4;
  if (["resume-generation", "linkedin"].includes(name)) return 5;
  if (["extension", "auto-apply"].includes(name)) return 6;
  if (name === "deus-mechanicus") return 7;
  return -1;
}

function depsAreMet(featureName, features) {
  const deps = DEPENDENCY_MAP[featureName] || [];
  return deps.every((d) => features[d]?.status === "done");
}

// ── Sections ──────────────────────────────────────────────

function renderHeader(store) {
  const run = store.runLog?.runId || "unknown";
  const status = store.runLog?.finalStatus || "in_progress";
  const cb = store.circuitBreaker || "closed";
  const cbColor = cb === "closed" ? GREEN : cb === "open" ? RED : YELLOW;

  console.log(`\n${BOLD}${BG_BLUE}${WHITE} JOBZOOKA AGENT DASHBOARD ${RESET}`);
  console.log(
    `  ${DIM}○ waiting${RESET} → ${YELLOW}◐ builder coding${RESET} → ${BLUE}● code ready${RESET} → ${CYAN}✓ evaluator passed${RESET} → ${GREEN}✔ shipped${RESET}   ${RED}✗ failed (fix agent retries)${RESET}`,
  );
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
  console.log(
    `  Run: ${BOLD}${run}${RESET}  │  Status: ${BOLD}${status}${RESET}  │  Cycle: ${BOLD}${store.cycle}${RESET}  │  Circuit: ${cbColor}${cb}${RESET}`,
  );

  if (store.heartbeat) {
    const hb = store.heartbeat;
    console.log(
      `  Heartbeat: Phase ${hb.phase} → ${BOLD}${hb.feature}${RESET} [${hb.status}]  ${DIM}${timeSince(hb.timestamp)}${RESET}`,
    );
  }
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
}

function renderFeatures(store) {
  console.log(`\n${BOLD} FEATURES${RESET}\n`);

  // Group by phase
  const phases = {
    "Phase 0 — Foundation": [],
    "Phase 1 — Auth + Rockets": [],
    "Phase 2 — Onboarding": [],
    "Phase 2.5 — Shell": [],
    "Phase 3 — Market": [],
    "Phase 4 — Analysis": [],
    "Phase 5 — Content": [],
    "Phase 6 — Apply": [],
    "Phase 7 — Dev Tools": [],
  };

  for (const [name, feat] of Object.entries(store.features)) {
    if (name.startsWith("foundation-"))
      phases["Phase 0 — Foundation"].push([name, feat]);
    else if (name === "auth" || name === "rockets")
      phases["Phase 1 — Auth + Rockets"].push([name, feat]);
    else if (name === "onboarding")
      phases["Phase 2 — Onboarding"].push([name, feat]);
    else if (name === "shell" || name === "profile")
      phases["Phase 2.5 — Shell"].push([name, feat]);
    else if (name === "market-research")
      phases["Phase 3 — Market"].push([name, feat]);
    else if (
      ["deep-dive-qa", "skills-curation", "competitiveness"].includes(name)
    )
      phases["Phase 4 — Analysis"].push([name, feat]);
    else if (["resume-generation", "linkedin"].includes(name))
      phases["Phase 5 — Content"].push([name, feat]);
    else if (["extension", "auto-apply"].includes(name))
      phases["Phase 6 — Apply"].push([name, feat]);
    else if (name === "deus-mechanicus")
      phases["Phase 7 — Dev Tools"].push([name, feat]);
  }

  for (const [phase, features] of Object.entries(phases)) {
    if (features.length === 0) continue;

    const allDone = features.every(([, f]) => f.status === "done");
    const phaseIcon = allDone ? `${GREEN}✔${RESET}` : `${YELLOW}…${RESET}`;

    console.log(`  ${phaseIcon} ${BOLD}${phase}${RESET}`);

    for (const [name, feat] of features) {
      const icon = statusIcon(feat.status);
      const color = statusColor(feat.status);
      const owner = feat.owner ? `${DIM}(${feat.owner})${RESET}` : "";
      const fixes =
        feat.fixAttempts > 0
          ? ` ${RED}[${feat.fixAttempts} fixes]${RESET}`
          : "";
      console.log(
        `    ${icon} ${color}${pad(name, 24)}${RESET} ${pad(feat.status, 15)} ${owner}${fixes}`,
      );
    }
    console.log();
  }
}

function renderBugs(store) {
  const bugs = store.bugDataset || [];
  if (bugs.length === 0) {
    console.log(`${BOLD} BUGS${RESET}: ${DIM}none${RESET}\n`);
    return;
  }

  const open = bugs.filter((b) => !b.prevention);
  const prevented = bugs.filter((b) => b.prevention);
  console.log(
    `${BOLD} BUGS${RESET} (${bugs.length} total — ${GREEN}${prevented.length} prevented${RESET}, ${open.length > 0 ? RED + open.length + " open" + RESET : DIM + "0 open" + RESET})\n`,
  );

  for (const bug of bugs) {
    const statusTag = bug.prevention
      ? `${GREEN}PREVENTED${RESET}`
      : `${RED}OPEN${RESET}`;
    const recurTag =
      bug.recurrence > 1 ? `  ${RED}seen ${bug.recurrence}x${RESET}` : "";

    console.log(`  ${BOLD}${bug.id}${RESET} [${statusTag}]${recurTag}`);
    console.log(`    ${bug.pattern}`);
    console.log(
      `    ${DIM}Feature: ${bug.feature}  │  Agent: ${bug.agent}${RESET}`,
    );
    console.log(`    ${DIM}Root cause: ${bug.root_cause}${RESET}`);
    if (bug.prevention) {
      console.log(`    ${GREEN}Fix: ${bug.prevention}${RESET}`);
    }
    console.log();
  }
}

function renderCompliance(store) {
  const c = store.compliance;
  if (!c) {
    console.log(`${BOLD} COMPLIANCE${RESET}: ${RED}not configured${RESET}\n`);
    return;
  }

  console.log(`${BOLD} COMPLIANCE${RESET}`);
  console.log(`  Primary:  ${CYAN}${c.command}${RESET}`);
  console.log(`  Fallback: ${CYAN}${c.fallback}${RESET}`);
  console.log(`  Prompt:   ${DIM}${c.promptPrefix.slice(0, 70)}...${RESET}`);
  console.log();
}

function renderEvolution(store) {
  const evo = store.evolution || [];
  if (evo.length === 0) {
    console.log(`${BOLD} EVOLUTION${RESET}: ${DIM}no changes yet${RESET}\n`);
    return;
  }

  console.log(`${BOLD} EVOLUTION${RESET} (${evo.length} changes)\n`);
  for (const e of evo.slice(-10)) {
    const field = e.field ? `${YELLOW}${e.field}${RESET} — ` : "";
    console.log(`  Cycle ${e.cycle}: ${field}${e.change}`);
    console.log(`    ${DIM}Why: ${e.reason}${RESET}`);
  }
  console.log();
}

function renderKnownStubs(store) {
  const stubs = store.knownStubs || [];
  if (stubs.length === 0) return;

  console.log(
    `${BOLD} KNOWN STUBS${RESET} (${stubs.length} — evaluator exempt)\n`,
  );
  for (const s of stubs) {
    console.log(`  ${YELLOW}○${RESET} ${s}`);
  }
  console.log();
}

function renderRunLog(store) {
  const log = store.runLog;
  if (!log) return;

  console.log(`${BOLD} RUN LOG${RESET}`);
  console.log(
    `  Run: ${log.runId}  │  Started: ${log.startedAt}  │  Final: ${log.finalStatus || "in_progress"}`,
  );
  if (log.haltReason) console.log(`  ${RED}Halt: ${log.haltReason}${RESET}`);
  if (log.entries?.length > 0) {
    console.log(`  Entries: ${log.entries.length}`);
    for (const e of log.entries.slice(-5)) {
      console.log(
        `    ${DIM}${e.type} phase:${e.phase} build:${e.buildResult} eval:${e.evaluatorResult} sec:${e.securityResult}${RESET}`,
      );
    }
  }
  console.log();
}

function renderSummary(store) {
  const features = Object.values(store.features);
  const done = features.filter((f) => f.status === "done").length;
  const total = features.length;
  const pct = Math.round((done / total) * 100);

  const barLen = 30;
  const filled = Math.round((done / total) * barLen);
  const bar = `${GREEN}${"█".repeat(filled)}${DIM}${"░".repeat(barLen - filled)}${RESET}`;

  console.log(`${BOLD} PROGRESS${RESET}: ${bar} ${done}/${total} (${pct}%)\n`);

  const totalFixes = features.reduce((sum, f) => sum + (f.fixAttempts || 0), 0);
  const bugCount = (store.bugDataset || []).length;
  const preventedCount = (store.bugDataset || []).filter(
    (b) => b.prevention,
  ).length;

  console.log(
    `  Total fixes: ${totalFixes}  │  Bugs logged: ${bugCount}  │  Prevented: ${preventedCount}/${bugCount}`,
  );
  console.log(
    `  Failures: ${store.totalFailures} total, ${store.consecutiveFailures} consecutive`,
  );
  console.log();
}

function renderFeatureDetail(store, featureName) {
  const feat = store.features[featureName];
  if (!feat) {
    console.error(
      `${RED}Unknown feature: ${featureName}${RESET}\nAvailable: ${Object.keys(store.features).join(", ")}`,
    );
    process.exit(1);
  }

  const phase = getPhaseNumber(featureName);
  const deps = DEPENDENCY_MAP[featureName] || [];
  const depsMet = depsAreMet(featureName, store.features);
  const icon = statusIcon(feat.status);
  const color = statusColor(feat.status);

  console.log(`\n${BOLD}${BG_BLUE}${WHITE} FEATURE: ${featureName} ${RESET}\n`);
  console.log(
    `  Status:  ${icon} ${color}${feat.status}${RESET}    Phase: ${BOLD}${phase}${RESET}`,
  );
  console.log(
    `  Owner:   ${feat.owner ? BOLD + feat.owner + RESET : DIM + "unassigned" + RESET}`,
  );
  console.log(
    `  Fixes:   ${feat.fixAttempts > 0 ? RED + feat.fixAttempts + RESET : GREEN + "0" + RESET}`,
  );
  if (feat.note) console.log(`  Note:    ${DIM}${feat.note}${RESET}`);

  // Dependencies
  console.log(
    `\n  ${BOLD}Dependencies${RESET} (${depsMet ? GREEN + "all met" + RESET : RED + "BLOCKED" + RESET})`,
  );
  // For readability, collapse foundation deps
  const foundationDeps = deps.filter((d) => d.startsWith("foundation-"));
  const otherDeps = deps.filter((d) => !d.startsWith("foundation-"));
  if (foundationDeps.length > 0) {
    const allFoundationDone = foundationDeps.every(
      (d) => store.features[d]?.status === "done",
    );
    const fIcon = allFoundationDone ? `${GREEN}✔${RESET}` : `${RED}✗${RESET}`;
    console.log(`    ${fIcon} foundation (${foundationDeps.length} modules)`);
  }
  for (const dep of otherDeps) {
    const ds = store.features[dep];
    const dIcon =
      ds?.status === "done" ? `${GREEN}✔${RESET}` : `${RED}✗${RESET}`;
    console.log(`    ${dIcon} ${dep} — ${ds?.status || "unknown"}`);
  }
  if (deps.length === 0) console.log(`    ${DIM}(none)${RESET}`);

  // Dependents (who needs this)
  const dependents = Object.entries(DEPENDENCY_MAP)
    .filter(([, d]) => d.includes(featureName))
    .map(([name]) => name)
    .filter((n) => !n.startsWith("foundation-")); // skip foundation-internal
  if (dependents.length > 0) {
    console.log(`\n  ${BOLD}Blocks${RESET} (${dependents.length} features)`);
    for (const dep of dependents) {
      const ds = store.features[dep];
      console.log(`    → ${dep} ${DIM}(${ds?.status || "unknown"})${RESET}`);
    }
  }

  // Files
  console.log(`\n  ${BOLD}Files${RESET} (${(feat.files || []).length})`);
  for (const f of feat.files || []) {
    const exists = fs.existsSync(path.resolve(__dirname, "..", f));
    const eIcon = exists ? `${GREEN}✔${RESET}` : `${RED}✗${RESET}`;
    console.log(`    ${eIcon} ${f}`);
  }

  // Locked interfaces
  if (feat.lockedInterfaces?.length > 0) {
    console.log(
      `\n  ${BOLD}Locked Interfaces${RESET} (${feat.lockedInterfaces.length})`,
    );
    const cols = 3;
    for (let i = 0; i < feat.lockedInterfaces.length; i += cols) {
      const row = feat.lockedInterfaces
        .slice(i, i + cols)
        .map((li) => `${CYAN}${pad(li, 28)}${RESET}`)
        .join("");
      console.log(`    ${row}`);
    }
  }

  // Related bugs
  const relatedBugs = (store.bugDataset || []).filter(
    (b) =>
      b.feature === featureName ||
      b.feature === featureName.replace("foundation-", ""),
  );
  if (relatedBugs.length > 0) {
    console.log(`\n  ${BOLD}Bugs${RESET} (${relatedBugs.length})`);
    for (const bug of relatedBugs) {
      const hasPrevent = bug.prevention
        ? `${GREEN}prevented${RESET}`
        : `${RED}open${RESET}`;
      console.log(`    ${bug.id}: ${bug.pattern}`);
      console.log(
        `      ${DIM}root: ${bug.root_cause}${RESET}  [${hasPrevent}]`,
      );
    }
  }

  // Related evolution entries
  const relatedEvo = (store.evolution || []).filter(
    (e) =>
      e.change.toLowerCase().includes(featureName) ||
      e.reason.toLowerCase().includes(featureName),
  );
  if (relatedEvo.length > 0) {
    console.log(`\n  ${BOLD}Evolution History${RESET}`);
    for (const e of relatedEvo) {
      console.log(`    Cycle ${e.cycle}: ${e.change}`);
    }
  }

  console.log();
}

function renderReady(store) {
  console.log(`\n${BOLD} READY TO BUILD${RESET}\n`);
  console.log(
    `  ${DIM}Features whose dependencies are all done and status is not_started:${RESET}\n`,
  );

  let count = 0;
  for (const [name, feat] of Object.entries(store.features)) {
    if (feat.status !== "not_started") continue;
    if (!depsAreMet(name, store.features)) continue;

    const phase = getPhaseNumber(name);
    const fileCount = (feat.files || []).length;
    console.log(
      `  ${GREEN}▸${RESET} ${BOLD}${pad(name, 24)}${RESET} Phase ${phase}  │  ${fileCount} files`,
    );
    count++;
  }

  if (count === 0) {
    console.log(
      `  ${DIM}No features are ready. Check dependency chain.${RESET}`,
    );
  }

  // Also show blocked features
  console.log(`\n${BOLD} BLOCKED${RESET} (not_started, deps not met)\n`);
  let blockedCount = 0;
  for (const [name, feat] of Object.entries(store.features)) {
    if (feat.status !== "not_started") continue;
    if (depsAreMet(name, store.features)) continue;

    const deps = DEPENDENCY_MAP[name] || [];
    const missing = deps
      .filter((d) => store.features[d]?.status !== "done")
      .filter((d) => !d.startsWith("foundation-"));
    const missingFoundation = deps
      .filter((d) => d.startsWith("foundation-"))
      .filter((d) => store.features[d]?.status !== "done");

    let blockers = missing.join(", ");
    if (missingFoundation.length > 0) {
      blockers =
        (blockers ? blockers + ", " : "") +
        `foundation(${missingFoundation.length})`;
    }

    console.log(
      `  ${RED}✗${RESET} ${pad(name, 24)} waiting on: ${YELLOW}${blockers}${RESET}`,
    );
    blockedCount++;
  }
  if (blockedCount === 0) {
    console.log(`  ${DIM}Nothing blocked.${RESET}`);
  }
  console.log();
}

function renderDeps(store) {
  console.log(`\n${BOLD} DEPENDENCY GRAPH${RESET}\n`);

  const phaseGroups = {};
  for (const name of Object.keys(store.features)) {
    const p = getPhaseNumber(name);
    if (!phaseGroups[p]) phaseGroups[p] = [];
    phaseGroups[p].push(name);
  }

  for (const phase of Object.keys(phaseGroups).sort((a, b) => a - b)) {
    const features = phaseGroups[phase];
    console.log(`  ${BOLD}Phase ${phase}${RESET}`);
    for (const name of features) {
      const feat = store.features[name];
      const icon = statusIcon(feat.status);
      const deps = DEPENDENCY_MAP[name] || [];
      const nonFoundationDeps = deps.filter(
        (d) => !d.startsWith("foundation-"),
      );
      const hasFoundation = deps.some((d) => d.startsWith("foundation-"));

      let depStr = "";
      if (hasFoundation && nonFoundationDeps.length > 0) {
        depStr = `← foundation + ${nonFoundationDeps.join(", ")}`;
      } else if (hasFoundation) {
        depStr = "← foundation";
      } else if (nonFoundationDeps.length > 0) {
        depStr = `← ${nonFoundationDeps.join(", ")}`;
      }

      console.log(`    ${icon} ${pad(name, 24)} ${DIM}${depStr}${RESET}`);
    }
    console.log();
  }
}

function renderFiles(store) {
  console.log(`\n${BOLD} FILE OWNERSHIP${RESET}\n`);

  for (const [name, feat] of Object.entries(store.features)) {
    const files = feat.files || [];
    const icon = statusIcon(feat.status);
    let existCount = 0;
    for (const f of files) {
      if (fs.existsSync(path.resolve(__dirname, "..", f))) existCount++;
    }
    console.log(
      `  ${icon} ${pad(name, 24)} ${existCount}/${files.length} files on disk   ${statusColor(feat.status)}${feat.status}${RESET}`,
    );
  }
  console.log();
}

function renderTimeline(store) {
  console.log(`\n${BOLD} TIMELINE${RESET}\n`);

  const events = [];

  // Evolution entries
  for (const e of store.evolution || []) {
    events.push({
      time: e.timestamp,
      type: "evolution",
      text: `${MAGENTA}[EVO]${RESET} Cycle ${e.cycle}: ${e.change}`,
      detail: e.reason,
    });
  }

  // Run log entries
  for (const e of store.runLog?.entries || []) {
    const color =
      e.buildResult === "pass" && e.evaluatorResult?.startsWith("pass")
        ? GREEN
        : RED;
    events.push({
      time: e.timestamp,
      type: "gate",
      text: `${color}[GATE]${RESET} Phase ${e.phase}: build=${e.buildResult} eval=${e.evaluatorResult} sec=${e.securityResult}`,
      detail: null,
    });
  }

  // Heartbeat
  if (store.heartbeat) {
    events.push({
      time: store.heartbeat.timestamp,
      type: "heartbeat",
      text: `${CYAN}[BEAT]${RESET} Phase ${store.heartbeat.phase} → ${store.heartbeat.feature} [${store.heartbeat.status}]`,
      detail: null,
    });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.time) - new Date(b.time));

  for (const ev of events) {
    const ts = ev.time?.slice(0, 16).replace("T", " ") || "unknown";
    console.log(`  ${DIM}${ts}${RESET}  ${ev.text}`);
    if (ev.detail) console.log(`               ${DIM}↳ ${ev.detail}${RESET}`);
  }
  console.log();
}

// ── Alerts ───────────────────────────────────────────────

function renderAlerts(store) {
  const alerts = [];

  // Heartbeat staleness
  if (store.heartbeat?.timestamp) {
    const ms = Date.now() - new Date(store.heartbeat.timestamp).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins > 30) {
      alerts.push({
        level: "warn",
        text: `Heartbeat stale for ${mins}m (status: ${store.heartbeat.status}). Possible hang.`,
      });
    }
  }

  // Circuit breaker
  if (store.circuitBreaker === "open") {
    alerts.push({
      level: "crit",
      text: `Circuit breaker OPEN — ${store.totalFailures} total failures. System halted.`,
    });
  } else if (store.circuitBreaker === "half-open") {
    alerts.push({
      level: "warn",
      text: `Circuit breaker half-open — probing after cooldown.`,
    });
  }

  // Consecutive failures
  if (store.consecutiveFailures >= 2) {
    alerts.push({
      level: "warn",
      text: `${store.consecutiveFailures} consecutive failures (max 3 before escalation).`,
    });
  }

  // Halt reason
  if (store.runLog?.haltReason) {
    alerts.push({
      level: "crit",
      text: `Run halted: ${store.runLog.haltReason}`,
    });
  }

  // Eval failures
  for (const [name, feat] of Object.entries(store.features)) {
    if (feat.status === "eval_fail") {
      alerts.push({
        level: "warn",
        text: `${name} failed evaluation (fix attempt ${feat.fixAttempts}/3).`,
      });
    }
    if (feat.fixAttempts >= 3) {
      alerts.push({
        level: "crit",
        text: `${name} exhausted all 3 fix attempts.`,
      });
    }
  }

  // Unpreventable bugs
  const openBugs = (store.bugDataset || []).filter((b) => !b.prevention);
  if (openBugs.length > 0) {
    alerts.push({
      level: "info",
      text: `${openBugs.length} bug(s) without prevention rules: ${openBugs.map((b) => b.id).join(", ")}`,
    });
  }

  if (alerts.length === 0) {
    console.log(`${BOLD} ALERTS${RESET}: ${GREEN}all clear${RESET}\n`);
    return;
  }

  console.log(`${BOLD} ALERTS${RESET} (${alerts.length})\n`);
  for (const a of alerts) {
    const prefix =
      a.level === "crit"
        ? `${BG_RED}${WHITE} CRIT ${RESET}`
        : a.level === "warn"
          ? `${BG_YELLOW}${WHITE} WARN ${RESET}`
          : `${BLUE} INFO ${RESET}`;
    console.log(`  ${prefix} ${a.text}`);
  }
  console.log();
}

// ── Worktrees ────────────────────────────────────────────

function renderWorktrees() {
  console.log(`${BOLD} ACTIVE WORKTREES${RESET}\n`);

  try {
    const { execSync } = require("child_process");
    const output = execSync("git worktree list --porcelain", {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });

    const worktrees = [];
    let current = {};
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push(current);
        current = { path: line.replace("worktree ", "") };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.replace("HEAD ", "").slice(0, 8);
      } else if (line.startsWith("branch ")) {
        current.branch = line.replace("branch refs/heads/", "");
      } else if (line === "bare") {
        current.bare = true;
      }
    }
    if (current.path) worktrees.push(current);

    const mainTree = worktrees.shift(); // first is always the main repo
    if (mainTree) {
      console.log(
        `  ${GREEN}●${RESET} ${BOLD}main${RESET}  ${DIM}${mainTree.branch || "detached"}${RESET}  ${DIM}${mainTree.head || ""}${RESET}`,
      );
    }

    if (worktrees.length === 0) {
      console.log(`  ${DIM}No agent worktrees active.${RESET}`);
    } else {
      for (const wt of worktrees) {
        const name = path.basename(wt.path);
        const isAgent = name.startsWith("wt-") || name.startsWith("agent-");
        const icon = isAgent ? `${YELLOW}◐${RESET}` : `${BLUE}●${RESET}`;
        console.log(
          `  ${icon} ${BOLD}${name}${RESET}  ${CYAN}${wt.branch || "detached"}${RESET}  ${DIM}${wt.head || ""}${RESET}`,
        );
        console.log(`    ${DIM}${wt.path}${RESET}`);
      }
    }
  } catch {
    console.log(
      `  ${DIM}Could not read worktrees (git not available?)${RESET}`,
    );
  }
  console.log();
}

// ── Phase Progress Bars ──────────────────────────────────

function renderPhaseProgress(store) {
  console.log(`${BOLD} PHASE PROGRESS${RESET}\n`);

  const phaseDefs = [
    { name: "Foundation", id: 0 },
    { name: "Auth + Rockets", id: 1 },
    { name: "Onboarding", id: 2 },
    { name: "Shell + Profile", id: 2.5 },
    { name: "Market", id: 3 },
    { name: "Analysis", id: 4 },
    { name: "Content", id: 5 },
    { name: "Apply", id: 6 },
    { name: "Dev Tools", id: 7 },
  ];

  for (const phase of phaseDefs) {
    const feats = Object.entries(store.features).filter(
      ([name]) => getPhaseNumber(name) === phase.id,
    );
    const done = feats.filter(([, f]) => f.status === "done").length;
    const inProg = feats.filter(
      ([, f]) => f.status !== "done" && f.status !== "not_started",
    ).length;
    const total = feats.length;

    const barLen = 12;
    const filled = Math.round((done / total) * barLen);
    const partial = Math.round((inProg / total) * barLen);
    const empty = barLen - filled - partial;
    const bar = `${GREEN}${"█".repeat(filled)}${YELLOW}${"▓".repeat(partial)}${DIM}${"░".repeat(Math.max(0, empty))}${RESET}`;

    let statusLabel;
    if (done === total) statusLabel = `${GREEN}done${RESET}`;
    else if (inProg > 0) statusLabel = `${YELLOW}building${RESET}`;
    else if (
      feats.some(([name]) => depsAreMet(name, store.features)) &&
      done < total
    )
      statusLabel = `${CYAN}ready${RESET}`;
    else statusLabel = `${DIM}waiting${RESET}`;

    console.log(
      `  ${pad("P" + phase.id, 5)} ${bar} ${done}/${total}  ${pad(phase.name, 16)} ${statusLabel}`,
    );
  }
  console.log();
}

// ── Contracts ────────────────────────────────────────────

function renderContracts(store) {
  console.log(`\n${BOLD} SESSION DATA CONTRACTS${RESET}\n`);

  const contracts = [
    {
      step: 1,
      name: "Resume Parse",
      feature: "onboarding",
      writes: [
        "resumeRaw",
        "resumeStructured",
        "personal",
        "education",
        "context",
        "demographics",
      ],
      consumers: "Steps 2-10",
    },
    {
      step: 2,
      name: "Preferences",
      feature: "onboarding",
      writes: ["preferences", "demographics"],
      consumers: "Steps 4,5,8,9,10",
    },
    {
      step: 3,
      name: "Profile",
      feature: "onboarding",
      writes: ["profile"],
      consumers: "Steps 4-10",
    },
    {
      step: 4,
      name: "Query Gen",
      feature: "market-research",
      writes: ["generatedQueries", "marketSource", "marketRaw", "queryStats"],
      consumers: "Step 5",
    },
    {
      step: 5,
      name: "Market",
      feature: "market-research",
      writes: [
        "marketPrepReport",
        "marketAnalysis",
        "miningQuestions",
        "jobTypes",
      ],
      consumers: "Steps 6,7,8",
    },
    {
      step: 6,
      name: "Deep-Dive QA",
      feature: "deep-dive-qa",
      writes: ["miningResults", "miningChatMsgs", "rankedCategories"],
      consumers: "Steps 8,9,10",
    },
    {
      step: 7,
      name: "Skill Curation",
      feature: "skills-curation",
      writes: ["exclusions"],
      consumers: "Steps 8,9,10",
    },
    {
      step: 8,
      name: "Resumes",
      feature: "resume-generation",
      writes: ["masterResume", "generalResume", "targetedResumes"],
      consumers: "Steps 9,10",
    },
    {
      step: 9,
      name: "LinkedIn",
      feature: "linkedin",
      writes: ["linkedin", "formAnswers"],
      consumers: "Step 10",
    },
    {
      step: 10,
      name: "Auto-Apply",
      feature: "auto-apply",
      writes: ["applyData", "uploadedResumes"],
      consumers: "Extension",
    },
  ];

  for (const c of contracts) {
    const feat = store.features[c.feature];
    const fStatus = feat?.status || "unknown";
    const icon = statusIcon(fStatus);
    const writesStr = c.writes.map((w) => `${CYAN}${w}${RESET}`).join(", ");
    console.log(
      `  ${icon} Step ${pad(String(c.step), 2)} ${BOLD}${pad(c.name, 14)}${RESET} → ${writesStr}`,
    );
    console.log(
      `    ${DIM}Feature: ${c.feature} (${fStatus})  │  Read by: ${c.consumers}${RESET}`,
    );
  }

  // Rocket costs
  console.log(`\n  ${BOLD}Rocket Costs${RESET}`);
  console.log(
    `    ${DIM}Free: PARSE, PROFILE, QUERY_GEN, MARKET, RESUME_GEN, APPLY${RESET}`,
  );
  console.log(
    `    ${YELLOW}MARKET_PREP rerun: 50  │  TARGETED: 50/35/25 per cat  │  LINKEDIN: 75${RESET}`,
  );
  console.log(`    ${DIM}Free tier: 150 rockets per user${RESET}`);
  console.log();
}

// ── Hygiene ──────────────────────────────────────────────

function renderHygiene() {
  console.log(`\n${BOLD} HYGIENE RULES${RESET}\n`);

  const retroDir = path.resolve(
    __dirname,
    "..",
    "docs",
    "09-agentic-system",
    "retro",
  );
  const runs = [];

  try {
    for (const entry of fs.readdirSync(retroDir)) {
      const hygieneFile = path.join(retroDir, entry, "HYGIENE.md");
      if (fs.existsSync(hygieneFile)) {
        const content = fs.readFileSync(hygieneFile, "utf8");
        // Count rules: lines starting with "## Rule"
        const ruleMatches = content.match(/^## Rule \d+/gm) || [];
        // Extract rule summaries
        const rules = [];
        for (const match of ruleMatches) {
          const num = match.match(/\d+/)[0];
          const idx = content.indexOf(match);
          const titleEnd = content.indexOf("\n", idx);
          const title = content
            .slice(idx + match.length, titleEnd)
            .trim()
            .replace(/^—\s*/, "");
          rules.push({ num, title });
        }
        runs.push({ run: entry, count: rules.length, rules });
      }
    }
  } catch {
    console.log(`  ${DIM}Could not read retro directory.${RESET}`);
    return;
  }

  let totalRules = 0;
  for (const run of runs) {
    totalRules += run.count;
    console.log(`  ${BOLD}Run ${run.run}${RESET} — ${run.count} rules`);
    for (const r of run.rules) {
      console.log(`    ${YELLOW}#${pad(r.num, 3)}${RESET} ${r.title}`);
    }
    console.log();
  }
  console.log(`  ${BOLD}Total: ${totalRules} hygiene rules active${RESET}\n`);
}

// ── Health ───────────────────────────────────────────────

function renderHealth(store) {
  console.log(`\n${BOLD}${BG_BLUE}${WHITE} SYSTEM HEALTH CHECK ${RESET}\n`);

  const checks = [];

  // Store.json readable
  checks.push({ name: "store.json readable", ok: true });

  // Circuit breaker
  checks.push({
    name: "Circuit breaker closed",
    ok: store.circuitBreaker === "closed",
    detail: store.circuitBreaker,
  });

  // Heartbeat freshness
  const hbMs = store.heartbeat?.timestamp
    ? Date.now() - new Date(store.heartbeat.timestamp).getTime()
    : Infinity;
  const hbMins = Math.floor(hbMs / 60000);
  checks.push({
    name: "Heartbeat fresh (<30m)",
    ok: hbMins < 30,
    detail: `${hbMins}m ago`,
  });

  // No consecutive failures
  checks.push({
    name: "No consecutive failures",
    ok: store.consecutiveFailures === 0,
    detail: `${store.consecutiveFailures}`,
  });

  // No halted run
  checks.push({
    name: "Run not halted",
    ok: !store.runLog?.haltReason,
    detail: store.runLog?.haltReason || "running",
  });

  // Foundation complete
  const foundationDone = FOUNDATION_FEATURES.every(
    (f) => store.features[f]?.status === "done",
  );
  checks.push({
    name: "Foundation complete",
    ok: foundationDone,
  });

  // No eval failures
  const evalFails = Object.entries(store.features).filter(
    ([, f]) => f.status === "eval_fail",
  );
  checks.push({
    name: "No eval failures",
    ok: evalFails.length === 0,
    detail: evalFails.length > 0 ? evalFails.map(([n]) => n).join(", ") : "",
  });

  // Known stubs check
  const stubsMissing = (store.knownStubs || []).filter(
    (s) => !fs.existsSync(path.resolve(__dirname, "..", s)),
  );
  checks.push({
    name: "Known stubs exist on disk",
    ok: stubsMissing.length === 0,
    detail:
      stubsMissing.length > 0 ? `missing: ${stubsMissing.join(", ")}` : "",
  });

  // All bugs have prevention
  const openBugs = (store.bugDataset || []).filter((b) => !b.prevention);
  checks.push({
    name: "All bugs have prevention",
    ok: openBugs.length === 0,
    detail: openBugs.length > 0 ? openBugs.map((b) => b.id).join(", ") : "",
  });

  // Active worktrees
  let wtCount = 0;
  try {
    const wtDir = path.resolve(__dirname, "..", ".git", "worktrees");
    if (fs.existsSync(wtDir)) {
      wtCount = fs.readdirSync(wtDir).length;
    }
  } catch {}
  checks.push({
    name: "Worktrees active",
    ok: true,
    detail: `${wtCount} agent worktree(s)`,
  });

  // Render
  let passCount = 0;
  for (const c of checks) {
    const icon = c.ok ? `${GREEN}✔${RESET}` : `${RED}✗${RESET}`;
    const detail = c.detail ? ` ${DIM}(${c.detail})${RESET}` : "";
    console.log(`  ${icon} ${c.name}${detail}`);
    if (c.ok) passCount++;
  }

  const allPass = passCount === checks.length;
  console.log(
    `\n  ${allPass ? GREEN : YELLOW}${passCount}/${checks.length} checks passed${RESET}\n`,
  );
}

// ── Agents ───────────────────────────────────────────────

function getActiveWorktrees() {
  try {
    const { execSync } = require("child_process");
    const output = execSync("git worktree list --porcelain", {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    });
    const worktrees = [];
    let current = {};
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push(current);
        current = { path: line.replace("worktree ", "") };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.replace("HEAD ", "").slice(0, 8);
      } else if (line.startsWith("branch ")) {
        current.branch = line.replace("branch refs/heads/", "");
      }
    }
    if (current.path) worktrees.push(current);
    worktrees.shift(); // remove main repo
    return worktrees;
  } catch {
    return [];
  }
}

function renderAgents(store) {
  console.log(`\n${BOLD}${BG_BLUE}${WHITE} AGENT STATUS ${RESET}\n`);

  const hb = store.heartbeat || {};
  const worktrees = getActiveWorktrees();

  // ── Orchestration agents (Claude) ──
  console.log(`  ${BOLD}${CYAN}ORCHESTRATION${RESET} ${DIM}(claude)${RESET}\n`);

  // Boss
  const bossActive =
    store.runLog?.finalStatus === "in_progress" && !store.runLog?.haltReason;
  const bossStatus = bossActive
    ? `${GREEN}● active${RESET}`
    : store.runLog?.haltReason
      ? `${RED}● halted${RESET}`
      : `${DIM}○ idle${RESET}`;
  const bossDetail = bossActive
    ? `dispatching phase ${hb.phase || "?"}`
    : store.runLog?.haltReason || "";
  console.log(
    `    ${bossStatus}  ${BOLD}Boss${RESET}           ${DIM}reads store → dispatches tasks → checks gates${RESET}`,
  );
  if (bossDetail)
    console.log(`                     ${DIM}${bossDetail}${RESET}`);

  // Lead
  const evoCount = (store.evolution || []).length;
  const leadStatus =
    evoCount > 0 ? `${GREEN}● active${RESET}` : `${DIM}○ idle${RESET}`;
  console.log(
    `    ${leadStatus}  ${BOLD}Lead${RESET}           ${DIM}pattern analysis → rule updates → spec patches${RESET}`,
  );
  console.log(
    `                     ${DIM}${evoCount} evolution entries, ${(store.bugDataset || []).length} bugs tracked${RESET}`,
  );
  console.log();

  // ── Builder agents (Claude, in worktrees) ──
  console.log(
    `  ${BOLD}${YELLOW}BUILDERS${RESET} ${DIM}(claude → worktrees)${RESET}\n`,
  );

  // Active builders from worktrees
  if (worktrees.length > 0) {
    for (const wt of worktrees) {
      const name = path.basename(wt.path);
      console.log(`    ${YELLOW}◐ building${RESET}  ${BOLD}${name}${RESET}`);
      console.log(
        `                     ${DIM}branch: ${wt.branch || "detached"}  commit: ${wt.head || "?"}${RESET}`,
      );
      console.log(`                     ${DIM}${wt.path}${RESET}`);
    }
  }

  // Recently completed builders from feature owners
  const completedBuilders = Object.entries(store.features)
    .filter(
      ([, f]) =>
        f.owner &&
        f.owner !== "skeleton" &&
        ["built", "eval_pass", "security_pass", "done"].includes(f.status),
    )
    .map(([name, f]) => ({ feature: name, owner: f.owner, status: f.status }));

  if (completedBuilders.length > 0) {
    for (const b of completedBuilders) {
      const icon =
        b.status === "done"
          ? `${GREEN}✔ done${RESET}    `
          : b.status === "built"
            ? `${BLUE}● built${RESET}   `
            : `${CYAN}✓ reviewed${RESET}`;
      console.log(`    ${icon}  ${BOLD}${b.owner}${RESET} → ${b.feature}`);
    }
  }

  // Queued builders (not_started with deps met)
  const queued = Object.entries(store.features)
    .filter(
      ([name, f]) =>
        f.status === "not_started" && depsAreMet(name, store.features),
    )
    .map(([name]) => name);

  if (queued.length > 0) {
    console.log();
    for (const name of queued) {
      console.log(
        `    ${DIM}○ queued${RESET}    ${BOLD}${name}${RESET} ${DIM}(deps met, awaiting dispatch)${RESET}`,
      );
    }
  }

  // Blocked
  const blocked = Object.entries(store.features)
    .filter(
      ([name, f]) =>
        f.status === "not_started" && !depsAreMet(name, store.features),
    )
    .map(([name]) => {
      const deps = DEPENDENCY_MAP[name] || [];
      const missing = deps
        .filter((d) => store.features[d]?.status !== "done")
        .filter((d) => !d.startsWith("foundation-"));
      return { name, waiting: missing };
    });

  if (blocked.length > 0) {
    console.log();
    for (const b of blocked) {
      console.log(
        `    ${RED}✗ blocked${RESET}  ${BOLD}${b.name}${RESET} ${DIM}← ${b.waiting.join(", ")}${RESET}`,
      );
    }
  }
  console.log();

  // ── Fix agents (Claude) ──
  const fixing = Object.entries(store.features).filter(
    ([, f]) => f.status === "eval_fail" && f.fixAttempts > 0,
  );
  console.log(`  ${BOLD}${MAGENTA}FIX AGENTS${RESET} ${DIM}(claude)${RESET}\n`);
  if (fixing.length > 0) {
    for (const [name, f] of fixing) {
      console.log(
        `    ${MAGENTA}◐ fixing${RESET}   ${BOLD}${name}${RESET} ${DIM}(attempt ${f.fixAttempts}/3)${RESET}`,
      );
    }
  } else {
    console.log(`    ${DIM}○ none active${RESET}`);
  }
  console.log();

  // ── Review agents (Claude) ──
  console.log(`  ${BOLD}${CYAN}REVIEWERS${RESET} ${DIM}(claude)${RESET}\n`);

  const awaitingEval = Object.entries(store.features).filter(
    ([, f]) => f.status === "built",
  );
  const awaitingSec = Object.entries(store.features).filter(
    ([, f]) => f.status === "eval_pass",
  );

  // Evaluator
  if (awaitingEval.length > 0) {
    console.log(
      `    ${YELLOW}◐ reviewing${RESET}  ${BOLD}Evaluator${RESET}  ${DIM}4-check protocol (structural, grounding, coverage, negative)${RESET}`,
    );
    for (const [name] of awaitingEval) {
      console.log(`                       ${DIM}→ ${name}${RESET}`);
    }
  } else {
    console.log(
      `    ${DIM}○ idle${RESET}       ${BOLD}Evaluator${RESET}  ${DIM}4-check protocol${RESET}`,
    );
  }

  // Security
  if (awaitingSec.length > 0) {
    console.log(
      `    ${YELLOW}◐ scanning${RESET}   ${BOLD}Security${RESET}   ${DIM}OWASP top 10, auth boundaries, API key exposure${RESET}`,
    );
    for (const [name] of awaitingSec) {
      console.log(`                       ${DIM}→ ${name}${RESET}`);
    }
  } else {
    console.log(
      `    ${DIM}○ idle${RESET}       ${BOLD}Security${RESET}   ${DIM}OWASP top 10, auth, prompt injection${RESET}`,
    );
  }
  console.log();

  // ── External provider agents ──
  const compliance = store.compliance || {};
  const primaryCmd = compliance.command || "codex";
  const fallbackCmd = compliance.fallback || "gemini";

  console.log(
    `  ${BOLD}${GREEN}COMPLIANCE${RESET} ${DIM}(external providers)${RESET}\n`,
  );

  // Primary compliance reviewer
  const awaitingCompliance = Object.entries(store.features).filter(
    ([, f]) => f.status === "security_pass",
  );
  if (awaitingCompliance.length > 0) {
    console.log(
      `    ${YELLOW}◐ auditing${RESET}   ${BOLD}${primaryCmd}${RESET} ${DIM}(primary)${RESET}`,
    );
    console.log(
      `                       ${DIM}5-point audit: branch theft, phantom completion, spec${RESET}`,
    );
    console.log(
      `                       ${DIM}compliance, hygiene adherence, hallucinated deps${RESET}`,
    );
    for (const [name] of awaitingCompliance) {
      console.log(`                       ${DIM}→ ${name}${RESET}`);
    }
  } else {
    console.log(
      `    ${DIM}○ standby${RESET}    ${BOLD}${primaryCmd}${RESET} ${DIM}(primary) — adversarial process audit${RESET}`,
    );
  }

  // Fallback
  console.log(
    `    ${DIM}○ standby${RESET}    ${BOLD}${fallbackCmd}${RESET} ${DIM}(fallback) — used if primary unavailable${RESET}`,
  );

  console.log();

  // ── Pipeline summary ──
  const totalFeats = Object.keys(store.features).length;
  const byStatus = {};
  for (const f of Object.values(store.features)) {
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
  }

  console.log(`  ${BOLD}PIPELINE SUMMARY${RESET}`);
  console.log(
    `    ${DIM}not_started:${RESET} ${byStatus.not_started || 0}` +
      `  ${YELLOW}in_progress:${RESET} ${byStatus.in_progress || 0}` +
      `  ${BLUE}built:${RESET} ${byStatus.built || 0}` +
      `  ${CYAN}eval_pass:${RESET} ${byStatus.eval_pass || 0}` +
      `  ${RED}eval_fail:${RESET} ${byStatus.eval_fail || 0}` +
      `  ${GREEN}done:${RESET} ${byStatus.done || 0}` +
      `  ${DIM}total:${RESET} ${totalFeats}`,
  );
  console.log();

  // Feature lifecycle reminder
  console.log(
    `  ${DIM}Lifecycle: not_started → in_progress → built → eval_pass → security_pass → done${RESET}`,
  );
  console.log(
    `  ${DIM}On failure: eval_fail → fix agent (up to 3x) → re-eval${RESET}`,
  );
  console.log();
}

// ── Main ──────────────────────────────────────────────────

function getArgValue(flag) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

function render() {
  const store = loadStore();
  const args = process.argv.slice(2);

  if (args.includes("--json")) {
    console.log(JSON.stringify(store, null, 2));
    return;
  }
  if (args.includes("--feature")) {
    const name = getArgValue("--feature");
    if (!name) {
      console.error(`${RED}Usage: --feature <feature-name>${RESET}`);
      console.log(
        `\nAvailable features:\n  ${Object.keys(store.features).join("\n  ")}`,
      );
      process.exit(1);
    }
    renderFeatureDetail(store, name);
    return;
  }
  if (args.includes("--agents")) {
    renderHeader(store);
    renderAgents(store);
    return;
  }
  if (args.includes("--ready")) {
    renderHeader(store);
    renderReady(store);
    return;
  }
  if (args.includes("--deps")) {
    renderDeps(store);
    return;
  }
  if (args.includes("--files")) {
    renderFiles(store);
    return;
  }
  if (args.includes("--timeline")) {
    renderTimeline(store);
    return;
  }
  if (args.includes("--health")) {
    renderHealth(store);
    return;
  }
  if (args.includes("--contracts")) {
    renderContracts(store);
    return;
  }
  if (args.includes("--hygiene")) {
    renderHygiene();
    return;
  }
  if (args.includes("--worktrees")) {
    renderWorktrees();
    return;
  }
  if (args.includes("--phase")) {
    renderHeader(store);
    renderFeatures(store);
    return;
  }
  if (args.includes("--bugs")) {
    renderBugs(store);
    return;
  }
  if (args.includes("--log")) {
    renderRunLog(store);
    return;
  }

  // Full dashboard
  renderHeader(store);
  renderAlerts(store);
  renderSummary(store);
  renderPhaseProgress(store);
  renderWorktrees();
  renderFeatures(store);
  renderCompliance(store);
  renderBugs(store);
  renderKnownStubs(store);
  renderEvolution(store);
  renderRunLog(store);
}

if (process.argv.includes("--once")) {
  render();
} else {
  const INTERVAL = 30000;
  const clear = () => process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
  const tick = () => {
    clear();
    render();
    console.log(
      `${DIM}Auto-refreshing every ${INTERVAL / 1000}s. Ctrl+C to stop.${RESET}`,
    );
  };
  tick();
  setInterval(tick, INTERVAL);
}
