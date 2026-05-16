#!/usr/bin/env node

/**
 * scripts/sprint/paths.js — Sprint Workflow v0.2 path resolver.
 *
 * Wraps scripts/hooks/lib/paths.js so the helpers in scripts/sprint/*
 * don't carry their own path table.
 *
 * Static directory roots (no per-sprint logic):
 *
 *   SPRINT.root                 -> .claude/project/sprint
 *   SPRINT.activeRegistry       -> .claude/project/sprint/active-sprints.yaml
 *   SPRINT.sprints              -> .claude/project/sprint/sprints
 *   SPRINT.history              -> .claude/project/sprint/history
 *   SPRINT.planContracts        -> .claude/project/sprint/plan-contracts
 *   SPRINT.tickets              -> .claude/project/sprint/tickets
 *   SPRINT.issues               -> .claude/project/sprint/issues
 *   SPRINT.issuesLedger         -> issues.md (repo root)
 *   SPRINT.externalServices     -> .claude/project/sprint/external-services
 *   SPRINT.releases             -> .claude/project/sprint/releases
 *   SPRINT.approvals            -> .claude/project/sprint/approvals
 *   SPRINT.decisions            -> .claude/project/sprint/decisions
 *   SPRINT.ralph                -> .claude/project/sprint/ralph
 *   SPRINT.checkpoints          -> .claude/project/sprint/checkpoints
 *   SPRINT.requirements         -> .claude/project/sprint/requirements
 *   SPRINT.templates            -> framework/templates/sprint
 *   SPRINT.schemas              -> schemas/sprint
 *   SPRINT.routing              -> sprint-routing.json
 *   SPRINT.reference            -> sprint-workflow.md
 *   SPRINT.PROJECT              -> repo root (absolute)
 *
 * Per-sprint resolvers (v0.2, replace the singletons):
 *
 *   SPRINT.active()             -> primary sprint id from active-sprints.yaml
 *   SPRINT.entry(id)            -> registry entry for the given id (or null)
 *   SPRINT.forSprint(id)        -> { current, progress, ralph, checkpoints,
 *                                    requirements, history } absolute paths.
 *                                  Honors `layout` (legacy_root → flat files;
 *                                  per_sprint_subdir → sprints/<id>/…).
 *   SPRINT.current              -> shorthand for SPRINT.forSprint(active()).current
 *   SPRINT.progress             -> shorthand for SPRINT.forSprint(active()).progress
 *
 * SPRINT.current and SPRINT.progress are GETTERS — every access reads the
 * registry. This keeps the legacy `SPRINT.current` consumer surface byte-
 * compatible while making it correctly target the new layout when one
 * exists.
 *
 * Fail-open: if active-sprints.yaml is missing or malformed, SPRINT.current
 * / SPRINT.progress fall back to the legacy singleton paths so v0.1
 * downstreams (and partial migrations) keep working.
 *
 * No new dependencies. Reading the registry is done via the existing
 * scripts/sprint/fs.js#readYamlMaybe (lazy-required to avoid a circular).
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Worktree shadow rescue: when invoked from a `.claude/worktrees/<agent>` shadow,
// CLAUDE_PROJECT_DIR is typically unset and the hook paths lib resolves PROJECT
// to the worktree (which has no sprint registry). Resolve to the canonical
// main worktree's repo root before requiring `../hooks/lib/paths`.
// Fail-safe: any error leaves CLAUDE_PROJECT_DIR unset (current behavior).
(function rescueProjectDirFromWorktree() {
  try {
    if (process.env.CLAUDE_PROJECT_DIR) return;
    const cwd = process.cwd();
    const looksLikeWorktree =
      /[\\/]\.claude[\\/]worktrees[\\/]/.test(cwd) ||
      /worktrees/.test(path.basename(path.dirname(cwd)));
    // Heuristic 2: in a worktree, .git is a FILE (gitdir pointer), not a dir.
    let gitFile = false;
    try {
      const gitPath = path.join(cwd, ".git");
      const st = fs.statSync(gitPath);
      gitFile = st.isFile();
    } catch {
      // no .git at cwd, walk up checking
      let cursor = cwd;
      for (let i = 0; i < 6; i++) {
        try {
          const st = fs.statSync(path.join(cursor, ".git"));
          gitFile = st.isFile();
          break;
        } catch {
          const parent = path.dirname(cursor);
          if (parent === cursor) break;
          cursor = parent;
        }
      }
    }
    if (!looksLikeWorktree && !gitFile) return;
    const { execSync } = require("child_process");
    // Ask git for the common dir; the parent of `.git/worktrees` is the
    // canonical main worktree.
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (!commonDir) return;
    const abs = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(cwd, commonDir);
    // commonDir points at the main repo's `.git` (e.g. `/path/main/.git`);
    // its parent is the canonical main worktree.
    const mainRoot = path.dirname(abs);
    if (mainRoot && fs.existsSync(mainRoot)) {
      process.env.CLAUDE_PROJECT_DIR = mainRoot;
    }
  } catch {
    // Fail-open: leave CLAUDE_PROJECT_DIR unset.
  }
})();

const { PROJECT, PATHS } = require("../hooks/lib/paths");

function p(key, fallbackRel) {
  const v = PATHS && PATHS[key];
  if (v && typeof v === "string") return v;
  return path.join(PROJECT, fallbackRel);
}

const LEGACY_CURRENT = p(
  "sprintCurrent",
  ".claude/project/sprint/current-sprint.yaml",
);
const LEGACY_PROGRESS = p(
  "sprintProgress",
  ".claude/project/sprint/sprint-progress.yaml",
);

const SPRINT = {
  PROJECT,
  root: p("sprintRoot", ".claude/project/sprint"),
  activeRegistry: p(
    "sprintActiveRegistry",
    ".claude/project/sprint/active-sprints.yaml",
  ),
  sprints: p("sprintSprints", ".claude/project/sprint/sprints"),
  history: p("sprintHistory", ".claude/project/sprint/history"),
  planContracts: p(
    "sprintPlanContracts",
    ".claude/project/sprint/plan-contracts",
  ),
  tickets: p("sprintTickets", ".claude/project/sprint/tickets"),
  issues: p("sprintIssues", ".claude/project/sprint/issues"),
  issuesLedger: p("sprintIssuesLedger", "issues.md"),
  externalServices: p(
    "sprintExternalServices",
    ".claude/project/sprint/external-services",
  ),
  releases: p("sprintReleases", ".claude/project/sprint/releases"),
  approvals: p("sprintApprovals", ".claude/project/sprint/approvals"),
  decisions: p("sprintDecisions", ".claude/project/sprint/decisions"),
  ralph: p("sprintRalph", ".claude/project/sprint/ralph"),
  checkpoints: p("sprintCheckpoints", ".claude/project/sprint/checkpoints"),
  requirements: p("sprintRequirements", ".claude/project/sprint/requirements"),
  templates: p("sprintTemplates", "framework/templates/sprint"),
  schemas: p("sprintSchemas", "schemas/sprint"),
  routing: p(
    "sprintRouting",
    ".claude/agents/00-alex/.system/policy/sprint-routing.json",
  ),
  reference: p(
    "sprintReference",
    ".claude/project/reference/sprint-workflow.md",
  ),
  LEGACY_CURRENT,
  LEGACY_PROGRESS,
};

// ── Registry-aware per-sprint resolvers ──────────────────────────

let _fsModule = null;
function fsModule() {
  if (_fsModule) return _fsModule;
  // Lazy require to avoid circular dependency at module-load time.
  _fsModule = require("./fs");
  return _fsModule;
}

function loadRegistry() {
  if (!fs.existsSync(SPRINT.activeRegistry)) return null;
  try {
    return fsModule().readYamlMaybe(SPRINT.activeRegistry);
  } catch {
    return null;
  }
}

function active() {
  // Per-invocation override: WARPOS_SPRINT_ID env (set by parseSprintArg)
  // wins over the registry primary. This lets a helper invoked with
  // --sprint <SP-id> target a non-primary sprint without rewriting the
  // registry.
  if (process.env.WARPOS_SPRINT_ID) return process.env.WARPOS_SPRINT_ID;
  const reg = loadRegistry();
  if (!reg || !reg.primary) return null;
  return reg.primary;
}

// parseSprintArg — convention shared by every sprint helper.
// Looks for "--sprint <SP-id>" in argv. If found, validates that id
// exists in active-sprints.yaml and sets process.env.WARPOS_SPRINT_ID
// so SPRINT.active() and the centralized logger both pick it up.
//
// If the id is unknown, writes COPY C-10 to stderr and returns null —
// the caller is expected to exit non-zero. If --sprint is omitted,
// returns the registry primary (or null if no registry yet).
//
// Side effect: sets process.env.WARPOS_SPRINT_ID. This is intentional
// so downstream helpers (logger.js, decisions/ledger.js) auto-tag.
function parseSprintArg(argv) {
  let explicit = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--sprint") {
      explicit = argv[i + 1] || null;
      break;
    }
  }
  if (explicit) {
    const reg = loadRegistry();
    const known =
      reg && Array.isArray(reg.sprints)
        ? reg.sprints.some((s) => s.id === explicit)
        : false;
    if (!known) {
      process.stderr.write(
        `unknown sprint: ${explicit}. See ${SPRINT.activeRegistry} for the live set, or run /sprint:status.\n`,
      );
      return { id: null, error: "unknown_sprint" };
    }
    process.env.WARPOS_SPRINT_ID = explicit;
    return { id: explicit, error: null };
  }
  // No --sprint flag — fall back to primary.
  const primary = active();
  return { id: primary, error: null };
}

function entry(id) {
  if (!id) return null;
  const reg = loadRegistry();
  if (!reg || !Array.isArray(reg.sprints)) return null;
  return reg.sprints.find((s) => s.id === id) || null;
}

function pointerDir(reg, id) {
  const e =
    reg && Array.isArray(reg.sprints)
      ? reg.sprints.find((s) => s.id === id)
      : null;
  if (e && e.pointer) {
    // pointer is relative to repo root in the registry; resolve to absolute.
    return path.isAbsolute(e.pointer)
      ? e.pointer
      : path.join(SPRINT.PROJECT, e.pointer);
  }
  // No registry entry — assume per-sprint subdir if id is provided.
  return path.join(SPRINT.sprints, id);
}

function forSprint(id) {
  const reg = loadRegistry();
  const e = entry(id);
  const dir = pointerDir(reg, id);
  const layout = e && e.layout ? e.layout : "per_sprint_subdir";
  let current, progress;
  if (layout === "legacy_root") {
    // Legacy v0.1 layout: files at paths.sprintRoot (singleton-shaped).
    current = LEGACY_CURRENT;
    progress = LEGACY_PROGRESS;
  } else {
    current = path.join(dir, "current.yaml");
    progress = path.join(dir, "progress.yaml");
  }
  return {
    id,
    layout,
    pointer: dir,
    current,
    progress,
    ralph: path.join(SPRINT.ralph, id),
    checkpoints: SPRINT.checkpoints,
    requirements: path.join(SPRINT.requirements, id),
    history: path.join(SPRINT.history, id),
  };
}

SPRINT.active = active;
SPRINT.entry = entry;
SPRINT.forSprint = forSprint;
SPRINT.parseSprintArg = parseSprintArg;

// Back-compat: SPRINT.current and SPRINT.progress as getters that resolve
// via the registry. If no registry, fall back to legacy singleton paths.
Object.defineProperty(SPRINT, "current", {
  enumerable: true,
  get() {
    const id = active();
    if (!id) return LEGACY_CURRENT;
    return forSprint(id).current;
  },
});
Object.defineProperty(SPRINT, "progress", {
  enumerable: true,
  get() {
    const id = active();
    if (!id) return LEGACY_PROGRESS;
    return forSprint(id).progress;
  },
});

module.exports = SPRINT;
