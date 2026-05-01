#!/usr/bin/env node
// Stop hook: auto-generates handoff when a session ends + copies to clipboard.
// Assembles: git state + user prompt log + compact summaries → paths.handoffLatest

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logEvent, log, query, RUNTIME_DIR } = require("./lib/logger");
const { PATHS } = require("./lib/paths");
let _projectName = "Project";
try {
  const { getProjectName } = require("./lib/project-config");
  _projectName = getProjectName() || "Project";
} catch {
  /* no project-config — use default */
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    // Use CLAUDE_PROJECT_DIR (reliable) instead of event.cwd (can be a subdirectory)
    const cwd = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    const claudeDir = path.join(cwd, ".claude");
    const handoffsDir = PATHS.handoffs;

    // Idempotent guard — don't regenerate if already done this session
    const runtimeDir = PATHS.runtime;
    fs.mkdirSync(runtimeDir, { recursive: true });
    const guardPath = path.join(runtimeDir, ".session-handoff-done");
    if (fs.existsSync(guardPath)) {
      process.stderr.write(
        "[Session Stop] Handoff already generated this session — skipping\n",
      );
      process.exit(0);
      return;
    }

    // Preserve guard — if handoff.md starts with "<!-- preserve: ... -->",
    // a manual/crafted handoff is in place. Write only the timestamped copy,
    // don't touch handoff.md.
    const handoffLatest =
      PATHS.handoffLatest || path.join(runtimeDir, "handoff.md");
    let preserveManual = false;
    try {
      if (fs.existsSync(handoffLatest)) {
        const first = fs.readFileSync(handoffLatest, "utf8").slice(0, 200);
        if (first.includes("<!-- preserve:")) {
          preserveManual = true;
          process.stderr.write(
            "[Session Stop] handoff.md has preserve marker — writing timestamped copy only\n",
          );
        }
      }
    } catch {
      /* ignore */
    }
    // `preserveManual` is consulted when writing handoff.md below

    // Ensure handoffs dir exists
    if (!fs.existsSync(handoffsDir)) {
      fs.mkdirSync(handoffsDir, { recursive: true });
    }

    const lines = [];
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 16).replace(":", "");

    lines.push(`# Handoff — ${_projectName} — ${date}`);
    lines.push("");

    // === BRANCH STATE ===
    let branch = "unknown";
    let currentHead = "";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      currentHead = execSync("git rev-parse --short HEAD", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      const lastMsg = execSync("git log -1 --pretty=%s", {
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

      lines.push("## Branch State");
      lines.push("");
      lines.push(`- Branch: \`${branch}\``);
      lines.push(
        `- Uncommitted: ${uncommitted ? uncommitted + " files" : "clean"}`,
      );
      lines.push(`- Last commit: \`${currentHead}\` ${lastMsg}`);
      lines.push("");
    } catch {
      /* ignore */
    }

    // === SESSION CONVERSATION (from centralized event log) ===
    try {
      const prompts = query({ cat: "prompt", limit: 50 });
      if (prompts.length > 0) {
        lines.push("## Session Conversation");
        lines.push("");
        lines.push(
          "User messages this session (chronological — shows intent and decisions):",
        );
        lines.push("");
        prompts.forEach((e) => {
          const ts = new Date(e.ts).toISOString().slice(11, 19);
          const text = e.data?.stripped || "(no text)";
          lines.push(`- [${ts}] ${text.slice(0, 200)}`);
        });
        lines.push("");
      }
    } catch {
      /* ignore */
    }

    // === PLANS GENERATED THIS SESSION ===
    try {
      const planEvents = query({ cat: "plan", limit: 10 });
      if (planEvents.length > 0) {
        lines.push("## Plans Generated");
        lines.push("");
        for (const e of planEvents) {
          const ts = new Date(e.ts).toISOString().slice(11, 19);
          const file = e.data?.file || "unknown";
          lines.push(`- [${ts}] **${file}** (${e.data?.tool || "?"})`);
          if (e.data?.content) {
            const preview = e.data.content
              .replace(/\n/g, " ")
              .slice(0, 300)
              .trim();
            lines.push(`  > ${preview}...`);
          }
        }
        lines.push("");
      }

      // Plan-related user decisions
      const planResponses = query({ cat: "prompt", limit: 50 });
      const decisions = planResponses.filter(
        (e) => e.data?.is_plan_response || e.data?.is_plan_discussion,
      );
      if (decisions.length > 0) {
        lines.push("## Plan Decisions");
        lines.push("");
        for (const d of decisions.slice(-10)) {
          const ts = new Date(d.ts).toISOString().slice(11, 19);
          const tag = d.data?.is_plan_response ? "[DECISION]" : "[DISCUSS]";
          lines.push(
            `- [${ts}] ${tag} ${(d.data?.stripped || "").slice(0, 200)}`,
          );
        }
        lines.push("");
      }
    } catch {
      /* ignore */
    }

    // === COMPACTION SUMMARIES (from compact-saver) ===
    const compactPath = path.join(claudeDir, ".compact-summary.md");
    if (fs.existsSync(compactPath)) {
      try {
        const summary = fs.readFileSync(compactPath, "utf-8").trim();
        if (summary.length > 0) {
          lines.push(
            "## Session Summary (AI-generated from context compaction)",
          );
          lines.push("");
          lines.push(summary);
          lines.push("");
        }
      } catch {
        /* ignore */
      }
    }

    // === COMMITS THIS SESSION ===
    const startCommitPath = path.join(claudeDir, ".session-start-commit");
    let startCommit = "";
    if (fs.existsSync(startCommitPath)) {
      startCommit = fs.readFileSync(startCommitPath, "utf-8").trim();
    }

    if (startCommit && currentHead) {
      try {
        const sessionCommits = execSync(
          `git log --oneline ${startCommit}..HEAD`,
          { cwd, stdio: ["pipe", "pipe", "pipe"] },
        )
          .toString()
          .trim();

        if (sessionCommits) {
          lines.push("## Commits This Session");
          lines.push("");
          sessionCommits.split("\n").forEach((c) => lines.push(`- \`${c}\``));
          lines.push("");
        }

        const changedFiles = execSync(`git diff --stat ${startCommit}..HEAD`, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
        })
          .toString()
          .trim();

        if (changedFiles) {
          lines.push("## Files Changed (committed)");
          lines.push("");
          lines.push("```");
          lines.push(changedFiles);
          lines.push("```");
          lines.push("");
        }
      } catch {
        /* no commits this session */
      }
    }

    // === UNCOMMITTED CHANGES ===
    try {
      const diffStat = execSync("git diff --stat", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      const stagedStat = execSync("git diff --staged --stat", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();

      if (diffStat || stagedStat) {
        lines.push("## Uncommitted Changes");
        lines.push("");
        if (stagedStat) {
          lines.push("Staged:");
          lines.push("```");
          lines.push(stagedStat);
          lines.push("```");
        }
        if (diffStat) {
          lines.push("Unstaged:");
          lines.push("```");
          lines.push(diffStat);
          lines.push("```");
        }
        lines.push("");
      }
    } catch {
      /* ignore */
    }

    // === RECENT COMMITS ===
    try {
      const recentLog = execSync("git log --oneline -5", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      lines.push("## Recent Commits");
      lines.push("");
      recentLog.split("\n").forEach((c) => lines.push(`- \`${c}\``));
      lines.push("");
    } catch {
      /* ignore */
    }

    // === SPEC HEALTH (classified drift with confidence) ===
    try {
      const {
        compileAllTruth,
        checkFixtureDrift,
      } = require("../../scripts/truth-compiler");
      const results = compileAllTruth();
      const totals = { danger: 0, review: 0, cosmetic: 0, clear: 0 };
      const dangerItems = [];
      for (const r of results) {
        totals.danger += r.summary.danger || 0;
        totals.review += r.summary.review || 0;
        totals.cosmetic += r.summary.cosmetic || 0;
        totals.clear += r.summary.clear || 0;
        for (const gap of r.gaps) {
          if (gap.tier === 3)
            dangerItems.push(`${gap.file} ← ${gap.staleFrom}`);
        }
      }
      // Fixture drift
      let fixtureDriftCount = 0;
      try {
        fixtureDriftCount = checkFixtureDrift().length;
      } catch {
        /* optional */
      }
      const total =
        totals.danger + totals.review + totals.cosmetic + totals.clear;
      if (total > 0 || fixtureDriftCount > 0) {
        lines.push("## Spec Health");
        lines.push("");
        const parts = [];
        if (totals.danger > 0) parts.push(`${totals.danger} DANGER`);
        if (totals.review > 0) parts.push(`${totals.review} REVIEW`);
        if (totals.cosmetic > 0) parts.push(`${totals.cosmetic} COSMETIC`);
        if (totals.clear > 0) parts.push(`${totals.clear} CLEAR`);
        if (parts.length > 0) lines.push(`- Spec drift: ${parts.join(", ")}`);
        if (fixtureDriftCount > 0)
          lines.push(
            `- Fixture drift: ${fixtureDriftCount} (holdout, boss-only)`,
          );
        if (dangerItems.length > 0) {
          for (const item of dangerItems.slice(0, 5)) {
            lines.push(`  - DANGER: ${item}`);
          }
        }
        lines.push("");
      }
    } catch {
      /* spec health is optional */
    }

    // === ASSESS SESSION (do→assess→improve loop) ===
    try {
      const assessScript = path.join(cwd, "scripts", "assess-session.js");
      if (fs.existsSync(assessScript)) {
        const assessOutput = execSync(`node "${assessScript}"`, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 10000,
        })
          .toString()
          .trim();
        if (assessOutput) {
          lines.push("## Session Assessment");
          lines.push("");
          assessOutput.split("\n").forEach((l) => lines.push(`- ${l}`));
          lines.push("");
        }
      }
    } catch {
      /* assessment is optional */
    }

    // === RETRO CHECK ===
    try {
      const sessionStartPath = path.join(claudeDir, ".session-start-commit");
      const sessionStartTime = fs.existsSync(sessionStartPath)
        ? fs.statSync(sessionStartPath).mtimeMs
        : Date.now() - 3600000; // fallback: 1h ago

      // Count tool calls this session to determine if session was substantive
      let toolCallCount = 0;
      try {
        const toolEvents = query({ cat: "tool", limit: 500 });
        toolCallCount = toolEvents.length;
      } catch {
        toolCallCount = 0;
      }

      // Only check for retro if session had meaningful activity
      if (toolCallCount >= 10) {
        let hasRetro = false;
        // Retro path resolution: prefer manifest.projectPaths.retro (canonical
        // per-project path), fall back to common conventions. The 2026-04-29
        // /fix:deep RT-016 found this hook was looking in dirs that didn't
        // exist for this project, producing 23/23 false no-retro-created.
        const retroDirs = [];
        try {
          const manifestPath = path.join(claudeDir, "manifest.json");
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const retroPath =
              manifest.projectPaths && manifest.projectPaths.retro;
            if (retroPath) {
              retroDirs.push(path.join(cwd, retroPath));
            }
          }
        } catch {
          /* manifest read failed — fall back to convention paths below */
        }
        // Fallback conventions (older project layouts)
        retroDirs.push(
          path.join(
            cwd,
            ".claude",
            "agents",
            "02-oneshot",
            ".system",
            "retros",
          ),
          path.join(cwd, "docs", "09-agentic-system", "retro"),
          path.join(cwd, ".claude", "retros"),
        );

        for (const retroDir of retroDirs) {
          if (fs.existsSync(retroDir)) {
            try {
              const entries = fs.readdirSync(retroDir, { withFileTypes: true });
              for (const entry of entries) {
                const full = path.join(retroDir, entry.name);
                try {
                  const stat = fs.statSync(full);
                  if (stat.mtimeMs > sessionStartTime) {
                    hasRetro = true;
                    break;
                  }
                } catch {
                  /* skip */
                }
              }
            } catch {
              /* skip */
            }
          }
          if (hasRetro) break;
        }

        if (!hasRetro) {
          lines.push("## Retro Warning");
          lines.push("");
          lines.push(
            "**WARNING:** No retro was created this session. Convention requires /retro after significant work.",
          );
          lines.push("");
          logEvent(
            "warn",
            "system",
            "no-retro-created",
            "",
            `Session had ${toolCallCount} tool calls but no retro document`,
          );
          process.stderr.write(
            "\x1b[33m[session-stop] WARNING: No retro created this session.\x1b[0m\n",
          );
        }
      }
    } catch {
      /* retro check is optional */
    }

    // Pending spec-drift advisory (BACKLOG.md run-12 #6 + run-13 reconciler).
    // Reads requirements-staged.jsonl via the reconciler that joins envelopes
    // with status_update audit records — gives true-pending count, not the
    // stale envelope.status read.
    try {
      const { reconcile } = require("../lib/staged-drift-reconciler");
      const stagedFile = path.join(
        cwd,
        ".claude/project/events/requirements-staged.jsonl",
      );
      const r = reconcile(stagedFile);
      if (r.pending.length > 0) {
        lines.push("## Pending Spec Drift");
        lines.push("");
        lines.push(
          `**${r.pending.length} drift entr${r.pending.length === 1 ? "y" : "ies"} pending review.** Run \`/check:requirements review\` before next session to flush.`,
        );
        const features = Object.keys(r.byFeature).join(", ");
        if (features) lines.push(`Features: ${features}`);
        lines.push("");
        process.stderr.write(
          `\x1b[33m[session-stop] ${r.pending.length} pending drift entr${r.pending.length === 1 ? "y" : "ies"} (features: ${features || "?"}). Run /check:requirements review.\x1b[0m\n`,
        );
        logEvent(
          "warn",
          "system",
          "pending-spec-drift",
          "",
          `${r.pending.length} pending drift entries (${features})`,
        );
      }
    } catch {
      /* reconciler optional — never block session stop */
    }

    // Write handoff — but preserve a manual handoff if its preserve marker is set
    const handoff = lines.join("\n");
    if (!preserveManual) {
      fs.writeFileSync(path.join(runtimeDir, "handoff.md"), handoff);
    }
    logEvent(
      "lifecycle",
      "alex",
      "session-stop",
      "",
      `branch=${branch || "unknown"} handoff=${handoff.length} chars`,
    );

    // Timestamped copy
    fs.writeFileSync(path.join(handoffsDir, `${date}-${time}.md`), handoff);

    // Copy to clipboard (Windows: clip, macOS: pbcopy, Linux: xclip)
    try {
      const platform = process.platform;
      if (platform === "win32") {
        execSync("clip", { input: handoff, stdio: ["pipe", "pipe", "pipe"] });
      } else if (platform === "darwin") {
        execSync("pbcopy", { input: handoff, stdio: ["pipe", "pipe", "pipe"] });
      } else {
        execSync("xclip -selection clipboard", {
          input: handoff,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    } catch {
      /* clipboard not available — not critical */
    }

    // Clean up session-scoped files
    [startCommitPath, compactPath].forEach((f) => {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    });

    // Auto-post session summary to cross-session inbox
    try {
      const summaryMatch = handoff.match(
        /## Session Conversation[\s\S]*?- \[.*?\] (.+)/,
      );
      const branchMatch = handoff.match(/Branch: `(.+?)`/);
      const sessionId =
        process.env.CLAUDE_SESSION_ID || `session-${Date.now().toString(36)}`;
      const fromLabel = `${branchMatch ? branchMatch[1] : "unknown"} / ${sessionId}`;
      const messageText = `Session ended. ${summaryMatch ? "Last task: " + summaryMatch[1].slice(0, 200) : "See handoff for details."}`;

      log(
        "inbox",
        {
          from: fromLabel,
          message: messageText,
          files_changed: [],
        },
        { session: sessionId },
      );
    } catch {
      /* inbox post is optional */
    }

    // Mark handoff as done (idempotent guard — reuses guardPath from line 19)
    fs.writeFileSync(guardPath, new Date().toISOString());

    process.stderr.write(
      `[Session Stop] Handoff saved + copied to clipboard\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[Session Stop] Handoff failed: ${err.message}\n`);
    process.exit(0); // non-blocking
  }
});
