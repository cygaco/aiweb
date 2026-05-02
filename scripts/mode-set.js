#!/usr/bin/env node

/**
 * scripts/mode-set.js — Phase 2D mode state machine.
 *
 * The single canonical writer for `.claude/runtime/mode.json`. Validates
 * transitions, enforces lock semantics, and emits the enriched schema:
 *
 *   {
 *     "$schema": "warpos/mode-marker/v2",
 *     "mode": "solo" | "adhoc" | "oneshot",
 *     "enteredAt": "<ISO8601>",
 *     "enteredBy": "alpha" | "beta" | "delta" | "user" | "<agent>",
 *     "allowedTransitions": ["adhoc", "oneshot", ...],
 *     "activeBuild": "<id>" | null,
 *     "lockOwner": "<agent>" | null
 *   }
 *
 * Usage:
 *   node scripts/mode-set.js <mode> [--by <agent>] [--lock-owner <agent>] [--active-build <id>] [--force]
 *
 * Modes:
 *   solo     Alpha works directly with user. No team, no orchestrator.
 *   adhoc    α + β + γ team. Default development mode.
 *   oneshot  Delta runs standalone. Full skeleton builds.
 *
 * Transition rules:
 *   - solo    ↔ adhoc, oneshot   (always allowed)
 *   - adhoc   ↔ solo, oneshot    (oneshot only if no activeBuild)
 *   - oneshot → solo, adhoc      (only if lockOwner has cleared the lock)
 *
 * Pass --force to override transition validation. Logs the override.
 *
 * Exit codes:
 *   0  marker written
 *   1  invalid mode / arguments
 *   2  transition blocked (use --force to override)
 */

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MARKER_PATH = path.join(PROJECT_DIR, ".claude", "runtime", "mode.json");

const VALID_MODES = ["solo", "adhoc", "oneshot"];

const ALLOWED_TRANSITIONS = {
  solo: ["adhoc", "oneshot"],
  adhoc: ["solo", "oneshot"],
  oneshot: ["solo", "adhoc"],
};

function parseArgs(argv) {
  const out = {
    mode: null,
    by: "alpha",
    lockOwner: null,
    activeBuild: null,
    force: false,
  };
  if (argv.length === 0) return out;
  out.mode = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--by") out.by = argv[++i] || "alpha";
    else if (a === "--lock-owner") out.lockOwner = argv[++i] || null;
    else if (a === "--active-build") out.activeBuild = argv[++i] || null;
    else if (a === "--force") out.force = true;
  }
  return out;
}

function readCurrent() {
  try {
    const raw = fs.readFileSync(MARKER_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function validateTransition(from, to, opts) {
  if (!from) return { ok: true, reason: "no prior marker" };
  if (from.mode === to) return { ok: true, reason: "no-op" };
  const allowed = ALLOWED_TRANSITIONS[from.mode] || [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `transition ${from.mode} → ${to} not in allowedTransitions ${JSON.stringify(allowed)}`,
    };
  }
  // If source mode is locked by another owner, block (unless --force).
  if (from.lockOwner && from.lockOwner !== opts.by) {
    return {
      ok: false,
      reason: `mode ${from.mode} is locked by ${from.lockOwner}; lockOwner must clear the lock or use --force`,
    };
  }
  // If source mode has an active build, block transition out (unless --force).
  if (from.activeBuild && to !== from.mode) {
    return {
      ok: false,
      reason: `mode ${from.mode} has activeBuild=${from.activeBuild}; halt the build before switching modes`,
    };
  }
  return { ok: true, reason: "valid transition" };
}

function buildMarker(mode, opts, current) {
  // Preserve enteredAt when staying in the same mode (lock/activeBuild
  // updates are not new entries). Only stamp a fresh enteredAt on real
  // transitions or first-write.
  const enteredAt =
    current && current.mode === mode && current.enteredAt
      ? current.enteredAt
      : new Date().toISOString();
  return {
    $schema: "warpos/mode-marker/v2",
    mode,
    enteredAt,
    enteredBy: opts.by,
    allowedTransitions: ALLOWED_TRANSITIONS[mode] || [],
    activeBuild: opts.activeBuild,
    lockOwner: opts.lockOwner,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || !VALID_MODES.includes(args.mode)) {
    console.error(
      `mode-set: invalid mode ${JSON.stringify(args.mode)}; expected one of ${VALID_MODES.join("|")}`,
    );
    process.exit(1);
  }

  const current = readCurrent();
  const validation = validateTransition(current, args.mode, args);

  if (!validation.ok && !args.force) {
    console.error(`mode-set: blocked — ${validation.reason}`);
    console.error(`  current: ${JSON.stringify(current)}`);
    console.error(`  pass --force to override`);
    process.exit(2);
  }

  const marker = buildMarker(args.mode, args, current);
  if (args.force && !validation.ok) {
    marker._forced = {
      reason: validation.reason,
      forcedAt: new Date().toISOString(),
    };
  }

  fs.mkdirSync(path.dirname(MARKER_PATH), { recursive: true });
  fs.writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2) + "\n");

  console.log(
    `mode-set: ${current ? current.mode : "(none)"} → ${args.mode} (by ${args.by}${args.lockOwner ? ", lockOwner=" + args.lockOwner : ""}${args.activeBuild ? ", activeBuild=" + args.activeBuild : ""})`,
  );
}

main();
