#!/usr/bin/env node
// SessionStart hook: runs on new session, /clear, /resume, and post-compaction.
// Source-aware: handles each entry type differently.
// 1. Checks environment health
// 2. Saves starting commit for session-end diff
// 3. Loads previous handoff or checkpoint
// 4. Archives (not deletes) stale logs

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logEvent, query, RUNTIME_DIR } = require("./lib/logger");
const { PATHS } = require("./lib/paths");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    // Use CLAUDE_PROJECT_DIR (reliable) instead of event.cwd (can be a subdirectory)
    const cwd = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    const source = event.source || "startup";
    const checks = [];
    const claudeDir = path.join(cwd, ".claude");
    const runtimeDir = path.join(claudeDir, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const checkpointPath = path.join(runtimeDir, ".session-checkpoint.json");
    const guardPath = path.join(runtimeDir, ".session-handoff-done");
    const sessionIdPath = path.join(runtimeDir, ".session-id");

    // ── Generate Session ID ──────────────────────────────────
    // Each session gets a unique short ID (e.g., "s-1a2b3c")
    // Only create if file doesn't exist — parallel instances share the session ID
    // Instance-level differentiation is handled by logger.js (getInstanceId)
    if (!fs.existsSync(sessionIdPath)) {
      const id = "s-" + Date.now().toString(36).slice(-6);
      fs.writeFileSync(sessionIdPath, id);
      checks.push(`Session ID: ${id} (new)`);
    } else {
      const existingId = fs.readFileSync(sessionIdPath, "utf8").trim();
      checks.push(`Session ID: ${existingId} (existing)`);
    }

    // ── Source-Aware Log Handling ──────────────────────────────
    if (source === "clear") {
      // /clear: SAVE a checkpoint before clearing — preserve what happened
      try {
        saveCheckpoint(claudeDir, "clear");
        checks.push("Clear: checkpoint saved before reset");
      } catch {
        /* checkpoint is optional */
      }
    } else if (source === "resume") {
      // /resume: Do NOT delete logs — this is the same session continuing
      checks.push("Resume: keeping session logs intact");
    } else if (source === "compact") {
      // Post-compaction: Do NOT delete anything — mid-session
      checks.push("Compact: mid-session, logs preserved");
    } else {
      // "startup" — fresh session
      // Clear stale compact summary and observer state
      [".compact-summary.md", ".observer-state.jsonl"].forEach((f) => {
        const p = path.join(claudeDir, f);
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      });
      // Clear the handoff-done guard so Stop hook will generate fresh handoff
      try {
        if (fs.existsSync(guardPath)) fs.unlinkSync(guardPath);
      } catch {
        /* ignore */
      }
    }

    // ── Git State (all source types) ──────────────────────────
    let branch = "unknown";
    let currentHead = "";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      const status = execSync("git status --porcelain", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      const uncommitted = status ? status.split("\n").length : 0;
      checks.push(
        `Branch: ${branch}${uncommitted ? ` (${uncommitted} uncommitted)` : ""}`,
      );

      currentHead = execSync("git rev-parse HEAD", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();

      // Only save start commit on fresh startup (not clear/resume/compact)
      if (source === "startup") {
        fs.writeFileSync(
          path.join(claudeDir, ".session-start-commit"),
          currentHead,
        );
      }
    } catch {
      checks.push("Git: not available");
    }

    // ── Topology Snapshot ─────────────────────────────────────
    if (source === "startup" || source === "clear") {
      try {
        const watchedDirsFile = path.join(
          cwd,
          "docs",
          "00-canonical",
          "WATCHED_DIRS.json",
        );
        if (fs.existsSync(watchedDirsFile)) {
          const watchedDirs = JSON.parse(
            fs.readFileSync(watchedDirsFile, "utf8"),
          );
          const snapshot = { timestamp: new Date().toISOString(), dirs: {} };
          for (const dir of watchedDirs.directories || []) {
            const absDir = path.join(cwd, dir.path.replace(/\*\/?$/, ""));
            try {
              if (fs.existsSync(absDir)) {
                const entries = fs.readdirSync(absDir, { withFileTypes: true });
                snapshot.dirs[dir.path] = entries.map((e) => ({
                  name: e.name,
                  isDir: e.isDirectory(),
                }));
              }
            } catch {
              /* scan failed */
            }
          }
          fs.writeFileSync(
            path.join(runtimeDir, ".topology-snapshot.json"),
            JSON.stringify(snapshot, null, 2),
          );
        }
      } catch {
        /* topology snapshot is optional */
      }
    }

    // ── Sleep Journal ─────────────────────────────────────────
    let sleepContext = "";
    if (source === "startup" || source === "clear") {
      try {
        const sleepFiles = [
          {
            path: "dreams/journal.md",
            prefix: "SLEEP JOURNAL (last night):\n",
            limit: 1500,
          },
          {
            path: "dreams/coaching.md",
            prefix: "COACHING SUGGESTION:\n",
            limit: 500,
          },
        ];
        for (const sf of sleepFiles) {
          const filePath = path.join(claudeDir, sf.path);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if ((Date.now() - stat.mtimeMs) / 3600000 < 24) {
              sleepContext +=
                sf.prefix +
                fs.readFileSync(filePath, "utf8").slice(0, sf.limit) +
                "\n\n";
            }
          }
        }
        if (sleepContext) checks.push("Sleep: journal found — injected");
      } catch {
        /* sleep journal check is optional */
      }
    }

    // ── Environment Checks ─────────────────────────────────────
    if (source === "startup" || source === "clear") {
      // Check .env.local for ANTHROPIC_API_KEY (minimum required key)
      const envPath = path.join(cwd, ".env.local");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        // Always check for ANTHROPIC_API_KEY; project-config may add more
        const keys = ["ANTHROPIC_API_KEY"];
        try {
          const { loadConfig } = require("./lib/project-config");
          const cfg = loadConfig();
          if (cfg.requiredEnvKeys) keys.push(...cfg.requiredEnvKeys);
        } catch {
          /* no project-config — just check ANTHROPIC_API_KEY */
        }
        const missing = keys.filter((k) => !envContent.includes(k + "="));
        if (missing.length > 0) {
          checks.push(`Env: missing ${missing.join(", ")}`);
        } else {
          checks.push("Env: all keys present");
        }
      } else {
        checks.push(
          "Env: .env.local not found (ANTHROPIC_API_KEY needed for prompt enhancement)",
        );
      }

      if (!fs.existsSync(path.join(cwd, "node_modules"))) {
        checks.push("node_modules: MISSING — run npm install");
      }
    }

    // ── Load Handoff / Checkpoint ─────────────────────────────
    let handoffContext = "";

    // Priority 1: handoff.md (most recent, written by session-stop)
    const handoffPath = path.join(runtimeDir, "handoff.md");
    if (fs.existsSync(handoffPath)) {
      try {
        const stat = fs.statSync(handoffPath);
        const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
        if (ageHours < 72) {
          const content = fs.readFileSync(handoffPath, "utf-8").trim();
          if (content.length > 0) {
            handoffContext = content;
            checks.push(
              `Handoff: loaded (${ageHours < 1 ? "just now" : Math.round(ageHours) + "h ago"})`,
            );
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Priority 2: session checkpoint (written every 30min by session-tracker)
    if (!handoffContext && fs.existsSync(checkpointPath)) {
      try {
        const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
        const ageHours =
          (Date.now() - new Date(checkpoint.timestamp).getTime()) / 3600000;
        if (ageHours < 168) {
          // 7 days
          handoffContext = `SESSION CHECKPOINT (${ageHours < 1 ? "recent" : Math.round(ageHours) + "h ago"}):\n`;
          if (checkpoint.promptLog) {
            handoffContext += `\nRecent user messages:\n${checkpoint.promptLog}\n`;
          }
          checks.push(`Checkpoint: loaded (${Math.round(ageHours)}h ago)`);
        }
      } catch {
        /* ignore */
      }
    }

    // Priority 3: most recent timestamped handoff from handoffs/ directory
    if (!handoffContext) {
      try {
        const handoffsDir = PATHS.handoffs;
        if (fs.existsSync(handoffsDir)) {
          const files = fs
            .readdirSync(handoffsDir)
            .filter((f) => f.endsWith(".md"))
            .sort()
            .reverse();
          if (files.length > 0) {
            const latest = files[0];
            const stat = fs.statSync(path.join(handoffsDir, latest));
            const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
            if (ageHours < 168) {
              // 7 days
              handoffContext = fs
                .readFileSync(path.join(handoffsDir, latest), "utf-8")
                .trim();
              checks.push(
                `Handoff: loaded from archive (${latest}, ${Math.round(ageHours)}h ago)`,
              );
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!handoffContext) {
      checks.push("Handoff: none found");
    }

    // ── Systems Health Nudge ────────────────────────────────
    let systemsNudge = "";
    if (source === "startup" || source === "clear") {
      try {
        // Count pending learnings
        const learningsPath = path.join(PATHS.memory, "learnings.jsonl");
        if (fs.existsSync(learningsPath)) {
          const lines = fs
            .readFileSync(learningsPath, "utf8")
            .trim()
            .split("\n");
          let pending = 0;
          let total = 0;
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              total++;
              if (entry.pending_validation) pending++;
            } catch {
              /* skip */
            }
          }
          if (pending > 5) {
            systemsNudge += `SYSTEMS: ${pending}/${total} learnings pending validation — consider running /overseer:review\n`;
          }
        }
      } catch {
        /* systems nudge is optional */
      }

      // Prune old session/instance log directories (keep last 5)
      // Dirs are named "s-{sid}_{iid}" (new) or "s-{sid}" (legacy)
      try {
        const logsDir = PATHS.logs;
        if (fs.existsSync(logsDir)) {
          const dirs = fs
            .readdirSync(logsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith("s-"))
            .map((d) => ({
              name: d.name,
              mtime: fs.statSync(path.join(logsDir, d.name)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);
          for (const d of dirs.slice(5)) {
            fs.rmSync(path.join(logsDir, d.name), {
              recursive: true,
              force: true,
            });
          }
        }
      } catch {
        /* cleanup is non-blocking */
      }
    }

    // ── Inject context into model ──────────────────────────
    if (handoffContext || sleepContext || systemsNudge) {
      let ctx = "";
      if (handoffContext) {
        ctx += `PREVIOUS SESSION HANDOFF (auto-loaded):\n\n${handoffContext}\n\n`;
      }
      if (sleepContext) {
        ctx += `OVERNIGHT SLEEP CYCLE RESULTS:\n\n${sleepContext}\nThe system ran a sleep cycle since your last session. Review the findings above. Dream solutions are speculative — verify before acting on them.\n\n`;
      }
      if (systemsNudge) {
        ctx += `\n${systemsNudge}\n`;
      }
      ctx +=
        "Use this context to continue seamlessly. Do not ask the user to recap — you already have the state.";
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: ctx,
          },
        }),
      );
    }

    logEvent(
      "lifecycle",
      "alex",
      "session-start",
      "",
      `source=${source || "unknown"}`,
    );
    process.exit(0);
  } catch {
    process.exit(0);
  }
});

// ── Helpers ─────────────────────────────────────────────────

function saveCheckpoint(claudeDir, reason) {
  const checkpoint = {
    timestamp: new Date().toISOString(),
    reason,
  };

  // Recent prompts from centralized event log
  const recentPrompts = query({ cat: "prompt", limit: 30 });
  if (recentPrompts.length > 0) {
    checkpoint.promptLog = recentPrompts
      .map((e) => {
        const ts = new Date(e.ts).toISOString().slice(11, 19);
        return `[${ts}] ${(e.data?.stripped || "").slice(0, 200)}`;
      })
      .join("\n");
  }

  const rtDir = path.join(claudeDir, "runtime");
  fs.mkdirSync(rtDir, { recursive: true });
  fs.writeFileSync(
    path.join(rtDir, ".session-checkpoint.json"),
    JSON.stringify(checkpoint, null, 2),
  );
}
