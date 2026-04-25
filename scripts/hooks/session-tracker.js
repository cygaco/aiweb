#!/usr/bin/env node

/**
 * session-tracker.js — PostToolUse hook (ALL tools)
 *
 * Tracks every tool call result for the assessment engine.
 * Records: tool name, success/failure, timing, file touched, thread context.
 *
 * This is the "DO" part of the do→assess→improve loop.
 * Data feeds into assess-session.js at session end.
 *
 * Shared across terminals via filesystem — multiple Alex sessions
 * write to the same tracking file.
 */

const fs = require("fs");
const path = require("path");
const { logEvent, log, query } = require("./lib/logger");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || ".";

try {
  if (process.stdin.isTTY) process.exit(0);

  const chunks = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    let event;
    try {
      event = JSON.parse(chunks.join(""));
    } catch {
      process.exit(0);
    }

    const toolName = event?.tool_name || "";
    const toolInput = event?.tool_input || {};
    const toolResponse = event?.tool_response || {};

    // Determine success/failure
    let success = true;
    let errorMsg = "";

    if (typeof toolResponse === "string") {
      if (
        toolResponse.includes("error") ||
        toolResponse.includes("Error") ||
        toolResponse.includes("ENOENT") ||
        toolResponse.includes("failed")
      ) {
        success = false;
        errorMsg = toolResponse.slice(0, 200);
      }
    } else if (toolResponse?.error) {
      success = false;
      errorMsg =
        typeof toolResponse.error === "string"
          ? toolResponse.error.slice(0, 200)
          : "error object";
    }

    // Extract file context
    const filePath = toolInput.file_path || toolInput.command || "";
    const relFile = filePath
      .replace(PROJECT, "")
      .replace(/^[/\\]+/, "")
      .replace(/\\/g, "/")
      .slice(0, 100);

    // Extract keywords for thread detection
    const keywords = extractKeywords(relFile, toolInput);

    const entry = {
      ts: new Date().toISOString().slice(0, 19),
      tool: toolName,
      success,
      error: errorMsg || undefined,
      file: relFile || undefined,
      keywords,
      terminal: process.env.CLAUDE_SESSION_ID || "unknown",
    };

    // Centralized log (primary)
    log(
      "tool",
      {
        tool: toolName,
        success,
        error: errorMsg || undefined,
        file: relFile || undefined,
        keywords,
      },
      { actor: "alex" },
    );

    // ── Plan detection + archival ────────────────────────────
    if ((toolName === "Write" || toolName === "Edit") && toolInput.file_path) {
      const rel = relFile || "";
      if (
        rel.includes(".claude/runtime/plans/") &&
        !rel.includes("/archive/") &&
        rel.endsWith(".md")
      ) {
        try {
          const content =
            toolName === "Write"
              ? (toolInput.content || "").slice(0, 5000)
              : (toolInput.new_string || "").slice(0, 5000);
          if (content.length > 0) {
            log(
              "plan",
              {
                tool: toolName,
                file: rel,
                content,
                old_content:
                  toolName === "Edit"
                    ? (toolInput.old_string || "").slice(0, 2000)
                    : undefined,
              },
              { actor: "alex" },
            );

            // Auto-archive plan to survive session crashes
            const archiveDir = path.join(
              PROJECT,
              ".claude",
              "plans",
              "archive",
            );
            fs.mkdirSync(archiveDir, { recursive: true });
            const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "");
            const basename = path.basename(toolInput.file_path, ".md");
            const fullContent =
              toolName === "Write"
                ? toolInput.content || ""
                : `[Edit delta]\n\n--- OLD ---\n${toolInput.old_string || ""}\n\n--- NEW ---\n${toolInput.new_string || ""}`;
            fs.writeFileSync(
              path.join(archiveDir, `${ts}-${basename}.md`),
              fullContent.slice(0, 10000),
            );
          }
        } catch {
          /* plan logging is non-blocking */
        }
      }
    }

    // GAP-401: Hash agent results for GATE_CHECK verification
    // When an Agent returns, hash its response so store-validator can verify
    // that GATE_CHECK entries correspond to real agent outputs.
    if (toolName === "Agent" && toolResponse) {
      try {
        const crypto = require("crypto");
        const responseText =
          typeof toolResponse === "string"
            ? toolResponse
            : JSON.stringify(toolResponse);
        const hash = crypto
          .createHash("sha256")
          .update(responseText.slice(0, 5000))
          .digest("hex")
          .slice(0, 16);

        // Detect role from the prompt
        const prompt = (toolInput.prompt || "").slice(0, 500).toLowerCase();
        let role = "unknown";
        if (/evaluator/.test(prompt)) role = "evaluator";
        else if (/security/.test(prompt) && /scan|review|audit/.test(prompt))
          role = "security";
        else if (/compliance/.test(prompt)) role = "compliance";
        else if (/feature:\s*\S+/.test(toolInput.prompt || ""))
          role = "builder";

        // Extract feature name
        const featureMatch = (toolInput.prompt || "").match(
          /feature:\s*(\S+)/i,
        );
        const feature = featureMatch ? featureMatch[1] : "unknown";

        // Store hash
        const hashFile = path.join(
          PROJECT,
          ".claude",
          ".agent-result-hashes.json",
        );
        let hashes = {};
        try {
          hashes = JSON.parse(fs.readFileSync(hashFile, "utf8"));
        } catch {
          /* first write */
        }
        const key = `${role}-${feature}-${Date.now()}`;
        hashes[key] = {
          hash,
          role,
          feature,
          ts: new Date().toISOString(),
          success,
        };
        // Keep only last 50 entries
        const entries = Object.entries(hashes);
        if (entries.length > 50) {
          hashes = Object.fromEntries(entries.slice(-50));
        }
        fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2), "utf8");

        logEvent(
          "decision",
          "system",
          "agent-result-hashed",
          feature,
          `${role} result hash=${hash} success=${success}`,
        );
      } catch {
        /* non-blocking */
      }
    }

    // ── Periodic checkpoint (every 30 minutes) ──────────────
    try {
      const claudeDir = path.join(PROJECT, ".claude");
      const checkpointTimePath = path.join(claudeDir, ".last-checkpoint");
      const CHECKPOINT_INTERVAL = 30 * 60 * 1000; // 30 minutes

      let lastCheckpoint = 0;
      try {
        if (fs.existsSync(checkpointTimePath)) {
          lastCheckpoint = parseInt(
            fs.readFileSync(checkpointTimePath, "utf8"),
          );
        }
      } catch {
        /* ignore */
      }

      if (Date.now() - lastCheckpoint > CHECKPOINT_INTERVAL) {
        const checkpoint = {
          timestamp: new Date().toISOString(),
          reason: "periodic",
        };

        // Recent prompts from centralized log
        const recentPrompts = query({ cat: "prompt", limit: 20 });
        if (recentPrompts.length > 0) {
          checkpoint.promptLog = recentPrompts
            .map((e) => {
              const ts = new Date(e.ts).toISOString().slice(11, 19);
              return `[${ts}] ${(e.data?.stripped || "").slice(0, 200)}`;
            })
            .join("\n");
        }

        // Recent tool calls from centralized log
        const recentTools = query({ cat: "tool", limit: 10 });
        if (recentTools.length > 0) {
          checkpoint.recentTools = recentTools.map((e) => {
            const ts = new Date(e.ts).toISOString().slice(0, 19);
            return `${ts} ${e.data?.tool || "?"} ${e.data?.success ? "ok" : "ERR"} ${e.data?.file || ""}`.trim();
          });
        }

        fs.writeFileSync(
          path.join(claudeDir, ".session-checkpoint.json"),
          JSON.stringify(checkpoint, null, 2),
        );
        fs.writeFileSync(checkpointTimePath, String(Date.now()));
      }
    } catch {
      /* checkpoint is non-blocking */
    }

    process.exit(0);
  });
} catch {
  process.exit(0);
}

function extractKeywords(file, input) {
  const words = new Set();

  // From file path
  if (file) {
    const parts = file.split(/[/\\._-]/);
    parts.forEach((p) => {
      if (p.length > 2 && !/^(src|docs|lib|js|ts|tsx|md|json)$/.test(p)) {
        words.add(p.toLowerCase());
      }
    });
  }

  // From edit content (first 200 chars of old/new string)
  const text = [
    input.old_string || "",
    input.new_string || "",
    input.prompt || "",
    input.command || "",
    input.pattern || "",
  ].join(" ");

  // Extract feature names, component names, technical terms
  const techTerms =
    text.match(
      /\b(auth|rocket|market|resume|linkedin|onboarding|profile|competitiv|extension|skill|step\d+|deploy|security|stripe|redis|claude)\b/gi,
    ) || [];
  techTerms.forEach((t) => words.add(t.toLowerCase()));

  return [...words].slice(0, 10);
}
