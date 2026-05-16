#!/usr/bin/env node

/**
 * smart-context.js — Merged prompt engineer + context curator
 *
 * Replaces the legacy context-enhancer + prompt-enhancer hooks.
 * One Haiku call per message: infers intent, enriches the prompt,
 * and selects relevant context from all memory stores.
 *
 * Smart or nothing — no degraded fallback. If Haiku fails,
 * original prompt passes through with no context injected.
 *
 * Session dedup: tracks what's been injected per terminal session.
 * Permanent logs under paths.logs / {sessionId}/.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const { PROJECT, PATHS } = require("./lib/paths");
const { getProjectName, getProjectStack } = require("./lib/project-config");
const { getSessionId } = require("./lib/logger");
const {
  loadAllLearnings,
  loadAllTraces,
  loadAllBetaDecisions,
  loadInbox,
  getSystemState,
  stripSystemTags,
} = require("./lib/context-sources");

const CLAUDE_DIR = path.join(PROJECT, ".claude");

// ── Config ──────────────────────────────────────────────

// Load API key (hooks don't inherit Next.js env)
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const envPath = path.join(PROJECT, ".env.local");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const m = line.match(/^ANTHROPIC_API_KEY=(.+)$/);
        if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
      }
    }
  } catch {
    /* best-effort */
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = "claude-haiku-4-5-20251001";
// Bumped from 600 → 1000 to give the Haiku response room for the skills array
// (top-K ranker output piggy-backs on the existing call). AC-4.4 caps this at 1000.
const MAX_TOKENS = 1000;
const TIMEOUT_MS = 15000;

// Cap payload size per source. Observed: at 131 learnings the full-pool
// payload consistently timed out at the old 8s ceiling (LRN-2026-04-17
// smart-context timeout class). Haiku still sees the most recent slice.
const MAX_LEARNINGS = 60;
const MAX_TRACES = 20;
const MAX_DECISIONS = 20;

// ── Skill ranker config (SP-20260513-003 / T-20260513-047) ──────────
// Ships DARK by default — set SKILL_RANKER_ENABLED=1 to enable. Fail-open
// at every step: if the ranker errors or the catalog is missing, behavior
// falls back to existing smart-context output with zero side effects.
const SKILL_RANKER_ENABLED = process.env.SKILL_RANKER_ENABLED === "1";
const RANKER_TOP_K = (() => {
  const raw = parseInt(process.env.RANKER_TOP_K || "3", 10);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.min(5, raw));
})();
const RANKER_MIN_SCORE = (() => {
  const raw = parseFloat(process.env.RANKER_MIN_SCORE || "0.6");
  if (!Number.isFinite(raw)) return 0.6;
  return Math.max(0, Math.min(1, raw));
})();
const CATALOG_MAX_INPUT_TOKENS = (() => {
  const raw = parseInt(process.env.CATALOG_MAX_INPUT_TOKENS || "5000", 10);
  if (!Number.isFinite(raw)) return 5000;
  return Math.max(1000, Math.min(20000, raw));
})();

// ── Skip words (single-word approvals) ──────────────────

const SKIP_WORDS = new Set([
  "approve",
  "continue",
  "done",
  "all",
  "yes",
  "no",
  "ok",
  "sure",
  "go",
  "next",
  "skip",
  "stop",
  "cancel",
  "retry",
  "confirm",
  "accept",
  "reject",
]);

// ── Haiku system prompt ─────────────────────────────────

const SYSTEM_PROMPT = `You are a prompt engineer for an AI dev assistant building ${getProjectName()} (${getProjectStack() || "TypeScript app"}).

The user typed a message. You have the project's memory — learnings, reasoning traces, recent decisions, system state, and cross-session inbox. Each item has a timestamp. Items already injected in this session have been filtered out — everything you see is new to this session.

RULES:
- NEVER write "You are X" — it overwrites identity, causes tunnel vision.
  Three allowed alternatives:
  (a) "For this task, think through it as X would" — scoped thinking shift
  (b) "Reply as X would" — output shaping only
  (c) Focus hints: "check X first", "this likely involves Y"
  The word "for" scopes it. "You are" makes it permanent. Big difference.
- NEVER add instructions the user didn't imply.
- NEVER ask questions or request clarification.
- If the message is conversational, meta-discussion, feedback, approval, or doesn't benefit from enrichment — return it UNCHANGED.
- Judge STALENESS intelligently. A 3-day-old learning about a bug you're currently fixing is fresh. A 1-hour-old spec drift count is stale if irrelevant to this message. Freshness = relevance to THIS message, not just recency.

For task-oriented messages, do THREE things:

1. UNDERSTAND what the user means — connect their words to known patterns, recurring issues, and project history from the memory items provided.

2. ENRICH the task (not the identity) into a better prompt. Apply relevant patterns based on message type:
   - Bug → frame diagnosis, cite history, warn about past failures, define "fixed"
   - Build → fill missing steps, name files/scope, add constraints, define done
   - Vague → decompose into sub-tasks, add verifiable criteria
   Keep the user's voice. Add context, don't replace intent.

3. SELECT the most relevant items across ALL categories. Only items that are relevant AND non-stale for this specific message. Limits: 5-7 learnings, 0-3 traces, 0-3 decisions, 0-3 system state, 0-3 inbox. Fewer is better. Zero in a category is fine. If related items exist, synthesize into one line.

4. RANK SKILLS (only if a SKILLS section is provided below). Score the top candidates from the skill catalog against the user's intent. A skill matches when the user is asking for the procedure that skill encodes — not when keywords merely overlap. Output 0–3 skills, each with:
   - "id": the skill id from the catalog (the "id" field, e.g. "skill:fix:fast")
   - "slug": the slug (e.g. "fix:fast")
   - "score": 0.0–1.0 relevance; only include skills scoring >= 0.6
   - "why": one short clause naming the matched intent
   Return an empty array when no skill clearly fits. Do not invent skills — only use ids/slugs present in the SKILLS catalog. Never recommend skills the user did not implicitly ask for.

Output ONLY this JSON (no markdown, no explanation):
{"prompt":"...","learnings":["..."],"traces":["..."],"decisions":["..."],"state":["..."],"inbox":["..."],"skills":[{"id":"...","slug":"...","score":0.0,"why":"..."}]}

If no enrichment needed and no items are relevant:
{"prompt":"original text unchanged","learnings":[],"traces":[],"decisions":[],"state":[],"inbox":[],"skills":[]}`;

// ── Session dedup ───────────────────────────────────────

function getLogDir() {
  const sessionId = getSessionId();
  const dir = path.join(PATHS.logs, sessionId);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return { dir, sessionId };
}

function loadInjectedHashes(logDir) {
  try {
    const file = path.join(logDir, "injected.json");
    if (fs.existsSync(file)) {
      return new Set(JSON.parse(fs.readFileSync(file, "utf8")));
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveInjectedHashes(logDir, hashes) {
  try {
    const file = path.join(logDir, "injected.json");
    fs.writeFileSync(file, JSON.stringify([...hashes]));
  } catch {
    /* ignore */
  }
}

function hashItem(item) {
  const str = typeof item === "string" ? item : JSON.stringify(item);
  return crypto.createHash("md5").update(str).digest("hex").slice(0, 12);
}

// ── Format items for Haiku ──────────────────────────────

function formatLearningsForHaiku(learnings) {
  return learnings
    .map((l) => {
      const status = l.status || "logged";
      const tip = (l.tip || "").slice(0, 150);
      return `[${(l.ts || "?").slice(0, 10)}] [${l.intent || "?"}] (${status}) ${tip}`;
    })
    .join("\n");
}

function formatTracesForHaiku(traces) {
  return traces
    .map(
      (t) =>
        `[${t.ts || "?"}] [${t.id || "?"}] ${t.problem_type || "?"}/${t.framework_selected || "?"} -> ${t.outcome || "?"} (quality ${t.quality_score ?? "?"}): "${t.problem_summary || ""}"`,
    )
    .join("\n");
}

function formatDecisionsForHaiku(decisions) {
  const now = Date.now();
  return decisions
    .map((d) => {
      const age = now - new Date(d.ts).getTime();
      const ageStr =
        age < 3600000
          ? `${Math.round(age / 60000)}m ago`
          : age < 86400000
            ? `${Math.round(age / 3600000)}h ago`
            : `${Math.round(age / 86400000)}d ago`;
      const escalated = d.data?.escalated ? "ESCALATED" : "DECIDED";
      return `[${ageStr}] ${escalated}: Q: "${(d.data?.question || "").slice(0, 100)}" A: "${(d.data?.answer || d.data?.escalate_reason || "").slice(0, 120)}"`;
    })
    .join("\n");
}

function formatStateForHaiku(stateItems) {
  return stateItems.map((s) => `[${s.ts || "?"}] ${s.content}`).join("\n");
}

function formatInboxForHaiku(inboxItems) {
  return inboxItems
    .map(
      (m) =>
        `[${new Date(m.ts).toLocaleTimeString("en-GB", { hour12: false })}] ${m.from}: ${m.message}`,
    )
    .join("\n");
}

// ── Filter already-injected items ───────────────────────

function filterInjected(items, injectedHashes) {
  return items.filter((item) => !injectedHashes.has(hashItem(item)));
}

// ── Skill ranker helpers (SP-20260513-003 / T-20260513-047) ─────

// Rough token estimator: 4 chars/token average for English+JSON.
function estTokens(str) {
  return Math.ceil((str || "").length / 4);
}

// Load the catalog generated by scripts/generate-skill-catalog.js.
// Returns { entries, truncated } or null on any failure (fail-open).
function loadSkillCatalog() {
  try {
    const catalogPath = path.join(
      PROJECT,
      PATHS.skillCatalog || ".claude/runtime/skill-catalog.json",
    );
    if (!fs.existsSync(catalogPath)) return null;
    const raw = fs.readFileSync(catalogPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    // Only user-invocable entries with a non-empty description are useful to the ranker.
    const entries = parsed.entries.filter(
      (e) => e && e.user_invocable !== false && e.description,
    );
    return { entries, truncated: 0 };
  } catch {
    return null;
  }
}

// Format catalog for Haiku — compact one-liner per skill, capped to CATALOG_MAX_INPUT_TOKENS.
// Returns { text, totalShown, truncated } where truncated counts entries dropped.
function formatCatalogForHaiku(catalog) {
  if (!catalog || !Array.isArray(catalog.entries)) {
    return { text: "", totalShown: 0, truncated: 0 };
  }
  const lines = [];
  let tokenBudget = CATALOG_MAX_INPUT_TOKENS;
  let truncated = 0;
  // Catalog is already sorted alphabetically by generator; recency-truncated upstream.
  for (const e of catalog.entries) {
    const desc = (e.description || "").slice(0, 240);
    const tagPart =
      Array.isArray(e.tags) && e.tags.length > 0
        ? ` [${e.tags.slice(0, 4).join(",")}]`
        : "";
    const line = `${e.id} /${e.slug}${tagPart}: ${desc}`;
    const cost = estTokens(line) + 1; // +1 for the newline
    if (cost > tokenBudget) {
      truncated = catalog.entries.length - lines.length;
      break;
    }
    tokenBudget -= cost;
    lines.push(line);
  }
  return { text: lines.join("\n"), totalShown: lines.length, truncated };
}

// Sanitize and clamp Haiku's skills array. Returns at most RANKER_TOP_K entries
// scoring at least RANKER_MIN_SCORE, with descriptions sourced from the catalog
// (Haiku's "why" is informational, the user-visible description comes from the
// skill's own frontmatter so we never inject Haiku's paraphrase as canonical).
function sanitizeRankedSkills(rawSkills, catalog) {
  if (!Array.isArray(rawSkills) || rawSkills.length === 0) return [];
  if (!catalog || !Array.isArray(catalog.entries)) return [];
  const bySlug = new Map();
  const byId = new Map();
  for (const e of catalog.entries) {
    if (e.slug) bySlug.set(String(e.slug).toLowerCase(), e);
    if (e.id) byId.set(String(e.id).toLowerCase(), e);
  }
  const out = [];
  for (const s of rawSkills) {
    if (!s || typeof s !== "object") continue;
    const rawSlug = typeof s.slug === "string" ? s.slug.replace(/^\//, "") : "";
    const rawId = typeof s.id === "string" ? s.id : "";
    const entry =
      bySlug.get(rawSlug.toLowerCase()) || byId.get(rawId.toLowerCase());
    if (!entry) continue;
    const score = typeof s.score === "number" ? s.score : 0;
    if (!Number.isFinite(score) || score < RANKER_MIN_SCORE) continue;
    out.push({
      id: entry.id,
      slug: entry.slug,
      description: entry.description,
      score: Math.max(0, Math.min(1, score)),
      why: typeof s.why === "string" ? s.why.slice(0, 200) : "",
    });
  }
  // Highest score first, stable sort
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, RANKER_TOP_K);
}

// Emit one skill-suggested-vs-invoked event per ranked skill. Fail-open.
function emitSuggestedEvents(rankedSkills, promptText) {
  if (!Array.isArray(rankedSkills) || rankedSkills.length === 0) return;
  try {
    const { logSkillSuggested, hashPrompt } = require("./lib/skill-telemetry");
    const promptHash = hashPrompt(promptText || "");
    rankedSkills.forEach((skill, idx) => {
      try {
        logSkillSuggested({
          skill_id: skill.id,
          prompt_hash: promptHash,
          score: skill.score,
          rank: idx + 1,
        });
      } catch {
        /* telemetry failures are non-blocking */
      }
    });
  } catch {
    /* helper missing — fail-open */
  }
}

// ── Call Haiku ──────────────────────────────────────────

function callHaiku(userMessage, contextPayload) {
  return new Promise((resolve) => {
    if (!API_KEY) {
      resolve(null);
      return;
    }

    const body = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `User message: ${userMessage}\n\n${contextPayload}`,
        },
      ],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            const text = json?.content?.[0]?.text?.trim();
            if (!text) {
              resolve(null);
              return;
            }
            // Parse the JSON response from Haiku (strip markdown fences if present)
            const cleanText = text
              .replace(/^```(?:json)?\s*/i, "")
              .replace(/\s*```$/i, "");
            const parsed = JSON.parse(cleanText);
            if (parsed && typeof parsed.prompt === "string") {
              resolve(parsed);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ── Should skip? ────────────────────────────────────────

function shouldSkip(prompt) {
  if (process.env.DISABLE_SMART_CONTEXT === "1") return "env disabled";
  if (prompt.length <= 5) return "too short";
  if (prompt.startsWith("/")) return "slash command";
  if (SKIP_WORDS.has(prompt.toLowerCase().trim())) return "approval word";
  // Code-only: contains triple backticks but no substantial text outside them
  const withoutCode = prompt.replace(/```[\s\S]*?```/g, "").trim();
  if (prompt.includes("```") && withoutCode.length < 10) return "code-only";
  return null;
}

// ── Assemble additionalContext from Haiku response ──────

function assembleContext(result, injectedHashes, rankedSkills) {
  // Filter out lines already injected in this session
  const fresh = (arr) =>
    (arr || []).filter((line) => !injectedHashes.has(hashItem(line)));
  result = {
    learnings: fresh(result.learnings),
    traces: fresh(result.traces),
    decisions: fresh(result.decisions),
    state: fresh(result.state),
    inbox: fresh(result.inbox),
  };
  const parts = [];

  if (result.learnings?.length > 0) {
    parts.push(
      "RECENT LEARNINGS:\n" + result.learnings.map((l) => `  ${l}`).join("\n"),
    );
  }
  if (result.traces?.length > 0) {
    parts.push(
      "REASONING HISTORY:\n" + result.traces.map((t) => `  ${t}`).join("\n"),
    );
  }
  if (result.decisions?.length > 0) {
    parts.push(
      "RECENT ALEX β DECISIONS:\n" +
        result.decisions.map((d) => `  ${d}`).join("\n"),
    );
  }
  if (result.state?.length > 0) {
    parts.push(
      "SYSTEM STATE:\n" + result.state.map((s) => `  ${s}`).join("\n"),
    );
  }
  if (result.inbox?.length > 0) {
    parts.push(
      "CROSS-SESSION INBOX:\n" + result.inbox.map((m) => `  ${m}`).join("\n"),
    );
  }

  // SUGGESTED SKILLS block — emitted only if the ranker returned >= 1 entry
  // scoring above RANKER_MIN_SCORE. Format per copy.md C-3 (SP-20260513-003).
  if (Array.isArray(rankedSkills) && rankedSkills.length > 0) {
    const skillLines = rankedSkills.map((s) => {
      const desc = (s.description || "").split(/(?<=[.!?])\s/)[0].slice(0, 120);
      return `  /${s.slug} — ${desc} (score ${s.score.toFixed(2)})`;
    });
    parts.push("SUGGESTED SKILLS:\n" + skillLines.join("\n"));
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

// ── Logging ─────────────────────────────────────────────

function log(logDir, ts, prompt, result, skipReason, latencyMs, rankerNote) {
  try {
    let entry;
    if (skipReason) {
      entry = `[${ts}] SKIP (${skipReason}): ${prompt.replace(/\n/g, " ").slice(0, 200)}\n`;
    } else if (!result) {
      entry = `[${ts}] HAIKU_FAIL (${latencyMs}ms): ${prompt.replace(/\n/g, " ").slice(0, 200)}\n`;
    } else {
      const enriched = result.prompt !== prompt ? "ENRICHED" : "PASSTHROUGH";
      const counts = `L:${result.learnings?.length || 0} T:${result.traces?.length || 0} D:${result.decisions?.length || 0} S:${result.state?.length || 0} I:${result.inbox?.length || 0}`;
      const rankerSuffix = rankerNote ? ` [${rankerNote}]` : "";
      entry = `[${ts}] ${enriched} (${latencyMs}ms, ${counts})${rankerSuffix}\n  RAW: ${prompt.replace(/\n/g, " ").slice(0, 300)}\n  OUT: ${(result.prompt || "").replace(/\n/g, " ").slice(0, 300)}\n`;
    }
    fs.appendFileSync(path.join(logDir, "smart-context.log"), entry);
  } catch {
    /* don't block */
  }
}

// Distinct ranker fail-open log lines per copy.md C-5. Called from main()
// only when the ranker is enabled and we have a definitive failure mode.
function logRanker(logDir, ts, label, prompt, latencyMs) {
  try {
    const line = `[${ts}] ${label} (${latencyMs}ms): ${prompt.replace(/\n/g, " ").slice(0, 200)}\n`;
    fs.appendFileSync(path.join(logDir, "smart-context.log"), line);
  } catch {
    /* don't block */
  }
}

// ── Main ────────────────────────────────────────────────

async function main() {
  if (process.stdin.isTTY) process.exit(0);

  const chunks = [];
  process.stdin.setEncoding("utf8");
  await new Promise((resolve) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", resolve);
  });

  let event;
  try {
    event = JSON.parse(chunks.join(""));
  } catch {
    process.exit(0);
  }

  // Heartbeat: if adhoc team dir exists, write session ID for team-guard identity check
  // Session ID changes when Claude restarts — no TTL needed, no stale-on-idle risk
  try {
    const adhocDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
      "adhoc",
    );
    if (fs.existsSync(adhocDir)) {
      const sid = getSessionId();
      if (sid && sid !== "unknown") {
        fs.writeFileSync(
          path.join(adhocDir, "heartbeat.json"),
          JSON.stringify({ sessionId: sid }),
        );
      }
    }
  } catch {
    /* non-critical */
  }

  const rawPrompt = event?.prompt || event?.tool_input?.prompt || "";
  if (!rawPrompt || rawPrompt.length < 2) process.exit(0);

  const prompt = stripSystemTags(rawPrompt);
  if (!prompt || prompt.length < 2) process.exit(0);

  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const { dir: logDir } = getLogDir();

  // Skip check
  const skipReason = shouldSkip(prompt);
  if (skipReason) {
    log(logDir, ts, prompt, null, skipReason, 0);
    process.exit(0);
  }

  // Load all context
  const allLearnings = loadAllLearnings();
  const allTraces = loadAllTraces();
  const allDecisions = loadAllBetaDecisions();
  const inbox = loadInbox();
  const systemState = getSystemState();

  // Haiku sees the most recent slice per source — dedup happens on OUTPUT, not INPUT.
  // Full pool grew to 131+ learnings and consistently timed out the API call.
  // Slice picks the tail (newest entries) since JSONL is append-ordered.
  const recentLearnings = allLearnings.slice(-MAX_LEARNINGS);
  const recentTraces = allTraces.slice(-MAX_TRACES);
  const recentDecisions = allDecisions.slice(-MAX_DECISIONS);

  // Build Haiku payload from recent slices
  const sections = [];
  if (recentLearnings.length > 0)
    sections.push(
      `=== LEARNINGS (${recentLearnings.length} of ${allLearnings.length}) ===\n${formatLearningsForHaiku(recentLearnings)}`,
    );
  if (recentTraces.length > 0)
    sections.push(
      `=== REASONING TRACES (${recentTraces.length} of ${allTraces.length}) ===\n${formatTracesForHaiku(recentTraces)}`,
    );
  if (recentDecisions.length > 0)
    sections.push(
      `=== BETA DECISIONS (${recentDecisions.length} of ${allDecisions.length}) ===\n${formatDecisionsForHaiku(recentDecisions)}`,
    );
  if (systemState.length > 0)
    sections.push(
      `=== SYSTEM STATE (${systemState.length}) ===\n${formatStateForHaiku(systemState)}`,
    );
  if (inbox.length > 0)
    sections.push(
      `=== INBOX (${inbox.length}) ===\n${formatInboxForHaiku(inbox)}`,
    );

  // Skill-ranker payload (dark by default — gated on SKILL_RANKER_ENABLED).
  // Reuses the existing Haiku round-trip — no second API call.
  let skillCatalog = null;
  let catalogTruncated = 0;
  if (SKILL_RANKER_ENABLED) {
    skillCatalog = loadSkillCatalog();
    if (skillCatalog) {
      const formatted = formatCatalogForHaiku(skillCatalog);
      catalogTruncated = formatted.truncated;
      if (formatted.text) {
        sections.push(
          `=== SKILLS (${formatted.totalShown} of ${skillCatalog.entries.length}) ===\n${formatted.text}`,
        );
      }
    }
  }

  // If nothing to send, just pass through
  if (sections.length === 0) {
    log(logDir, ts, prompt, null, "no new context", 0);
    process.exit(0);
  }

  const contextPayload = sections.join("\n\n");

  // Call Haiku
  const startMs = Date.now();
  const result = await callHaiku(prompt, contextPayload);
  const latencyMs = Date.now() - startMs;

  if (!result) {
    // Smart or nothing — no fallback.
    // If the ranker was active, also tag this as RANKER_TIMEOUT for telemetry
    // (per copy.md C-5 — distinct from HAIKU_FAIL so we can see ranker-class
    // failures separately during rollout).
    log(logDir, ts, prompt, result, null, latencyMs);
    if (SKILL_RANKER_ENABLED && skillCatalog) {
      logRanker(logDir, ts, "RANKER_TIMEOUT", prompt, latencyMs);
    }
    process.exit(0);
  }

  // Sanitize Haiku's skills array against the catalog. The ranker is dead by
  // default; we only inject SUGGESTED SKILLS: when (a) the env flag is on,
  // (b) the catalog loaded, (c) Haiku returned a usable skills array, and
  // (d) at least one entry survived sanitization.
  let rankedSkills = [];
  let rankerNote = null;
  if (SKILL_RANKER_ENABLED) {
    if (!skillCatalog) {
      rankerNote = "CATALOG_MISSING";
      logRanker(logDir, ts, "CATALOG_MISSING", prompt, latencyMs);
    } else if (!Array.isArray(result.skills)) {
      rankerNote = "RANKER_PARSE_FAIL";
      logRanker(logDir, ts, "RANKER_PARSE_FAIL", prompt, latencyMs);
    } else {
      rankedSkills = sanitizeRankedSkills(result.skills, skillCatalog);
      if (rankedSkills.length === 0) {
        rankerNote = "RANKER_EMPTY";
        logRanker(logDir, ts, "RANKER_EMPTY", prompt, latencyMs);
      } else {
        rankerNote = `RANKER_OK(${rankedSkills.length})`;
        if (catalogTruncated > 0) {
          logRanker(
            logDir,
            ts,
            `CATALOG_TRUNCATED(${catalogTruncated})`,
            prompt,
            latencyMs,
          );
        }
        // Emit one skill-suggested-vs-invoked event per surfaced skill.
        // Fail-open: telemetry failures never block prompt assembly.
        emitSuggestedEvents(rankedSkills, prompt);
      }
    }
  }

  // Log (after ranker decisions so the suffix is accurate)
  log(logDir, ts, prompt, result, null, latencyMs, rankerNote);

  // Dedup on OUTPUT: only hash the strings Haiku actually selected.
  // Haiku always sees the full pool, but the same curated line
  // won't be injected into Alex α's context twice in one session.
  const injectedHashes = loadInjectedHashes(logDir);
  const newHashes = new Set(injectedHashes);
  const allSelected = [
    ...(result.learnings || []),
    ...(result.traces || []),
    ...(result.decisions || []),
    ...(result.state || []),
    ...(result.inbox || []),
  ];
  for (const line of allSelected) {
    newHashes.add(hashItem(line));
  }
  saveInjectedHashes(logDir, newHashes);

  // Assemble output
  const output = { hookSpecificOutput: { hookEventName: "UserPromptSubmit" } };

  // Enriched prompt (only if changed)
  if (result.prompt && result.prompt !== prompt) {
    output.hookSpecificOutput.modifiedPrompt = result.prompt;
  }

  // Curated context (includes SUGGESTED SKILLS: when the ranker fires)
  let context = assembleContext(result, injectedHashes, rankedSkills);

  // Mode-aware directive emission.
  //
  // Resolution order (highest priority first):
  //   1. ONESHOT — oneshot store.heartbeat.agent === "delta" AND fresh (<60min).
  //      Delta is standalone; β is NOT available; halt-and-save is the escalation.
  //   2. SOLO — .claude/runtime/mode.json says {mode: "solo"}. Alpha talks to user
  //      directly (feedback_solo_no_beta). No team-mode directive.
  //   3. ADHOC — legacy fallback: ~/.claude/teams/adhoc/config.json exists.
  //      α + β + γ team is active; route decisions through Beta.
  //   4. Unknown → emit nothing (no mode detected).
  try {
    const oneshotStorePath = path.join(
      PROJECT,
      ".claude",
      "agents",
      "02-oneshot",
      ".system",
      "store.json",
    );
    const modeMarkerPath = path.join(
      PROJECT,
      ".claude",
      "runtime",
      "mode.json",
    );
    const adhocTeamConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
      "adhoc",
      "config.json",
    );

    let directive = null;

    // 1. Oneshot — via Delta heartbeat freshness.
    if (fs.existsSync(oneshotStorePath)) {
      try {
        const store = JSON.parse(fs.readFileSync(oneshotStorePath, "utf8"));
        const hb = store && store.heartbeat;
        if (hb && hb.agent === "delta" && hb.timestamp) {
          const ageMs = Date.now() - new Date(hb.timestamp).getTime();
          if (Number.isFinite(ageMs) && ageMs < 60 * 60 * 1000) {
            directive =
              "ONESHOT MODE ACTIVE: Follow delta.md protocol. " +
              "Do NOT consult Beta (β is not available in oneshot). " +
              "Decisions outside Delta's mechanical scope: halt and save state to store.json. " +
              "The user can resume via /mode:oneshot in a fresh session.";
          }
        }
      } catch {
        /* store parse error — fall through */
      }
    }

    // 2. Solo — via explicit mode marker (Phase 2D v2 schema).
    if (!directive && fs.existsSync(modeMarkerPath)) {
      try {
        const marker = JSON.parse(fs.readFileSync(modeMarkerPath, "utf8"));
        // Phase 2D mode-mismatch detection: oneshot marker with activeBuild
        // but no fresh Delta heartbeat → marker stale, build never started
        // or crashed. Emit a warning so the user can recover (halt or clear lock).
        if (
          marker &&
          marker.mode === "oneshot" &&
          marker.activeBuild &&
          marker.lockOwner === "delta"
        ) {
          let heartbeatFresh = false;
          try {
            if (fs.existsSync(oneshotStorePath)) {
              const store = JSON.parse(
                fs.readFileSync(oneshotStorePath, "utf8"),
              );
              const hb = store && store.heartbeat;
              if (hb && hb.agent === "delta" && hb.timestamp) {
                const ageMs = Date.now() - new Date(hb.timestamp).getTime();
                heartbeatFresh =
                  Number.isFinite(ageMs) && ageMs < 60 * 60 * 1000;
              }
            }
          } catch {
            /* fall through */
          }
          if (!heartbeatFresh) {
            directive =
              "MODE MISMATCH: oneshot marker has activeBuild=" +
              JSON.stringify(marker.activeBuild) +
              " and lockOwner=delta, but Delta heartbeat is stale or missing. " +
              "Either resume the build (re-enter /mode:oneshot) or clear the lock: " +
              "node scripts/mode-set.js solo --by alpha --force.";
          }
        }
        if (!directive) {
          if (marker && marker.mode === "solo") {
            directive = null; // intentional: solo = no directive, talk to user directly.
          } else if (marker && marker.mode === "adhoc") {
            directive =
              "TEAM MODE ACTIVE: Do NOT ask the user questions. " +
              "Route ALL decisions through Beta (β) via SendMessage. " +
              "Only address user when Beta returns ESCALATE.";
          } else if (marker && marker.mode === "oneshot") {
            // Belt-and-suspenders for oneshot before heartbeat has settled.
            directive =
              "ONESHOT MODE ACTIVE: Follow delta.md protocol. " +
              "Do NOT consult Beta (β is not available in oneshot). " +
              "Decisions outside Delta's mechanical scope: halt and save state to store.json.";
          }
        }
      } catch {
        /* marker parse error — fall through */
      }
    }

    // 3. Adhoc fallback via legacy team config. Only fire if no mode marker exists
    //    AND no fresh oneshot heartbeat — otherwise marker / heartbeat wins.
    if (directive === null && !fs.existsSync(modeMarkerPath)) {
      if (fs.existsSync(adhocTeamConfigPath)) {
        directive =
          "TEAM MODE ACTIVE: Do NOT ask the user questions. " +
          "Route ALL decisions through Beta (β) via SendMessage. " +
          "Only address user when Beta returns ESCALATE.";
      }
    }

    if (directive) {
      context += (context ? "\n\n" : "") + directive;
    }
  } catch {
    /* best-effort */
  }

  // Phase 0 workstream E: one-shot per-session warning when Gemini auth
  // configuration is ambiguous (env API key set AND CLI configured for
  // OAuth-personal). The warning is best-effort — fail-silent on any
  // probe error. We dedupe via a session-scoped marker so the operator
  // sees the warning once, not every prompt.
  try {
    const markerDir = path.join(PROJECT, ".claude", "runtime");
    const marker = path.join(markerDir, ".gemini-auth-mismatch-warned");
    if (!fs.existsSync(marker)) {
      const {
        detectGeminiAuthSourceMismatch,
      } = require("./lib/provider-health.js");
      const mismatch = detectGeminiAuthSourceMismatch();
      if (mismatch) {
        const warning =
          "GEMINI_AUTH_NOTICE: GEMINI_API_KEY is set, but Gemini CLI " +
          "settings declare `auth.selectedType: " +
          mismatch.selected +
          "`. The CLI may silently use the OAuth account and ignore the " +
          "API key. Verify the intended auth source before interpreting " +
          "any `model_not_found` or quota errors from gemini.";
        context += (context ? "\n\n" : "") + warning;
        try {
          fs.mkdirSync(markerDir, { recursive: true });
          fs.writeFileSync(marker, new Date().toISOString());
        } catch {
          /* marker is optional */
        }
      }
    }
  } catch {
    /* probe failures are non-blocking */
  }

  if (context) {
    output.hookSpecificOutput.additionalContext = context;
  }

  if (
    output.hookSpecificOutput.modifiedPrompt ||
    output.hookSpecificOutput.additionalContext
  ) {
    process.stdout.write(JSON.stringify(output));
  }
}

main().catch(() => process.exit(0));
