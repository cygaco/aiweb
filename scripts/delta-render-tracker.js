#!/usr/bin/env node
/**
 * delta-render-tracker.js — render the run-N phase tracker.
 *
 * Usage:
 *   node scripts/delta-render-tracker.js
 *
 * Reads:
 *   - .claude/manifest.json                              (build.phases + build.features)
 *   - .claude/agents/02-oneshot/.system/store.json       (features[].status, heartbeat)
 *   - .claude/runtime/run.json                           (runNumber)
 *
 * Writes one ANSI-colored phase tree to stdout — meant for the orchestrator
 * to call after every state change so the user has a continuously-current view.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
}

const manifest = read(".claude/manifest.json");
const store = read(".claude/agents/02-oneshot/.system/store.json");
let runNumber = "?";
try {
  runNumber = read(".claude/runtime/run.json").runNumber;
} catch {
  /* ok */
}

const phases = manifest.build.phases;
const features = manifest.build.features;
const sf = store.features || {};
const heartbeat = store.heartbeat || {};

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

function statusOf(id) {
  if (id === "foundation") {
    const fs = Object.entries(sf).filter(([k]) => k.startsWith("foundation-"));
    if (fs.length === 0) return "?";
    if (fs.every(([, v]) => v.status === "done")) return "done";
    if (fs.some(([, v]) => v.status !== "not_started")) return "partial";
    return "not_started";
  }
  return (sf[id] && sf[id].status) || "?";
}

const SYM = {
  done: `${C.green}✓${C.reset}`,
  built: `${C.cyan}◐${C.reset}`,
  building: `${C.yellow}◌${C.reset}`,
  in_progress: `${C.yellow}◌${C.reset}`,
  awaiting_gauntlet: `${C.cyan}◑${C.reset}`,
  gauntlet: `${C.magenta}◓${C.reset}`,
  fixing: `${C.yellow}◔${C.reset}`,
  not_started: `${C.dim}○${C.reset}`,
  partial: `${C.yellow}◐${C.reset}`,
  failed: `${C.red}✗${C.reset}`,
  active: `${C.yellow}●${C.reset}`,
  "?": `${C.dim}?${C.reset}`,
};

const stCanonical = (st) => {
  if (st === "eval_pass" || st === "compliance_pass" || st === "security_pass")
    return "built";
  if (st === "awaiting-gauntlet") return "awaiting_gauntlet";
  return st;
};

function symbol(st) {
  return SYM[stCanonical(st)] || SYM["?"];
}

function phaseSymbol(features) {
  const ss = features.map((f) => statusOf(f.id));
  if (ss.every((s) => s === "done")) return SYM.done;
  if (ss.some((s) => ["building", "in_progress"].includes(s)))
    return SYM.active;
  if (ss.some((s) => ["built", "awaiting_gauntlet"].includes(s)))
    return SYM.built;
  return SYM.not_started;
}

const para = {
  true: `${C.dim}∥${C.reset}`,
  false: `${C.dim}→${C.reset}`,
};

const lines = [];
lines.push("");
lines.push(
  `  ${C.bold}RUN ${runNumber}${C.reset}  ${C.dim}—${C.reset}  ${C.cyan}${heartbeat.status || "?"}${C.reset}  ${C.dim}—${C.reset}  ${C.dim}cycle ${heartbeat.cycle ?? "?"}, phase ${heartbeat.phase ?? "?"}${C.reset}`,
);
if (heartbeat.note) {
  // wrap note at ~80 chars
  const note =
    heartbeat.note.length > 110
      ? heartbeat.note.slice(0, 107) + "..."
      : heartbeat.note;
  lines.push(`  ${C.dim}${note}${C.reset}`);
}
lines.push("");

for (const ph of phases) {
  const fInPhase = features.filter((f) => f.phase === ph.id);
  if (fInPhase.length === 0) continue;
  const sym = phaseSymbol(fInPhase);
  const par = para[String(ph.parallel)];
  lines.push(
    `  ${sym} ${C.bold}Phase ${ph.id}${C.reset}  ${par}  ${C.cyan}${ph.name}${C.reset}`,
  );
  for (const f of fInPhase) {
    const st = statusOf(f.id);
    const sym2 = symbol(st);
    const stLabel = stCanonical(st);
    const stColor =
      stLabel === "done"
        ? C.green
        : stLabel === "built"
          ? C.cyan
          : stLabel === "building" || stLabel === "in_progress"
            ? C.yellow
            : stLabel === "failed"
              ? C.red
              : C.dim;
    const deps = f.dependencies.length
      ? ` ${C.dim}← ${f.dependencies.join(", ")}${C.reset}`
      : "";
    const commit = sf[f.id]?.builderCommit
      ? ` ${C.dim}(${sf[f.id].builderCommit.slice(0, 7)})${C.reset}`
      : "";
    lines.push(
      `    ${sym2}  ${f.id.padEnd(20)} ${stColor}${stLabel}${C.reset}${commit}${deps}`,
    );
  }
  lines.push("");
}

lines.push(
  `  ${C.bold}Legend:${C.reset}  ${SYM.done} done  ${SYM.built} built  ${SYM.gauntlet} gauntlet  ${SYM.fixing} fixing  ${SYM.building} building  ${SYM.not_started} not_started  ${C.dim}∥${C.reset} parallel  ${C.dim}→${C.reset} sequential`,
);
lines.push("");

console.log(lines.join("\n"));
