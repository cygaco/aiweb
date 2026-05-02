#!/usr/bin/env node

/**
 * assess-session.js — The "ASSESS" part of do→assess→improve
 *
 * Runs at session end (called by session-stop.js) or on demand.
 * Reads all tracking data, detects conversation threads, evaluates
 * which enhancements were effective, and writes learnings.
 *
 * Thread detection: groups prompts and tool calls by topic continuity.
 * A "thread" is a multi-turn problem-solving conversation about one topic.
 *
 * Cross-terminal: reads from shared .session-tracking.jsonl and
 * .session-prompts.log (both terminals write to these).
 *
 * Assessment signals:
 *   - Speed: fast resolution = good
 *   - Errors: few tool errors = good
 *   - Retries: rephrased prompts = enhancement didn't help
 *   - Sentiment: "perfect"/"yes" = good, "no"/"wrong" = bad
 *   - Depth: many turns on same topic = hard problem (not bad, but informative)
 */

const fs = require("fs");
const path = require("path");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TRACKING_FILE = path.join(PROJECT, ".claude", ".session-tracking.jsonl");
const PROMPTS_FILE = path.join(PROJECT, ".claude", ".session-prompts.log");
const LEARNINGS_FILE = path.join(
  PROJECT,
  ".claude",
  "memory",
  "learnings.jsonl",
);
const THREADS_FILE = path.join(PROJECT, ".claude", ".session-threads.json");
const ASSESSMENTS_FILE = path.join(
  PROJECT,
  ".claude",
  ".session-assessments.json",
);

// ── Data Loading ─────────────────────────────────────────

function readLines(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return [];
    return raw.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function readJSONL(file) {
  return readLines(file)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ── Prompt Parsing ───────────────────────────────────────

function parsePrompts() {
  const lines = readLines(PROMPTS_FILE);
  return lines
    .map((line) => {
      const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/);
      if (!match) return null;
      return { time: match[1], text: match[2] };
    })
    .filter(Boolean);
}

// ── Keyword Extraction from Prompts ──────────────────────

function promptKeywords(text) {
  const words = new Set();
  const terms =
    text.match(
      /\b(auth|rocket|market|resume|linkedin|onboarding|profile|competitiv|extension|skill|security|deploy|stripe|redis|audit|refactor|bug|fix|test|build|spec|prd|stories?|inputs?|copy)\b/gi,
    ) || [];
  terms.forEach((t) => words.add(t.toLowerCase()));

  // Also extract quoted strings and file-like references
  const files = text.match(/[\w-]+\.(ts|tsx|js|md|json)/g) || [];
  files.forEach((f) => words.add(f.toLowerCase()));

  return [...words];
}

// ── Thread Detection ─────────────────────────────────────

function detectThreads(prompts, toolCalls) {
  const threads = [];
  let currentThread = null;

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const keywords = promptKeywords(prompt.text);

    if (!currentThread) {
      // Start new thread
      currentThread = {
        id: `THR-${Date.now().toString(36)}-${i}`,
        topic_keywords: keywords,
        prompts: [prompt],
        start_time: prompt.time,
        end_time: prompt.time,
        turn_count: 1,
      };
      continue;
    }

    // Check topic continuity: keyword overlap with current thread
    const overlap = keywords.filter((k) =>
      currentThread.topic_keywords.includes(k),
    );
    const overlapRatio =
      keywords.length > 0 ? overlap.length / keywords.length : 0;

    // Also check time gap (>10 min gap = likely new topic)
    const timeDiff =
      timeToMinutes(prompt.time) - timeToMinutes(currentThread.end_time);
    const isTimeGap = timeDiff > 10;

    // Same thread if: >25% keyword overlap AND <10 min gap
    // OR if prompt is very short (follow-up like "yes", "do it", "fix that")
    const isFollowUp = prompt.text.length < 30;

    if ((overlapRatio >= 0.25 && !isTimeGap) || (isFollowUp && !isTimeGap)) {
      // Continue thread
      currentThread.prompts.push(prompt);
      currentThread.end_time = prompt.time;
      currentThread.turn_count++;
      // Merge keywords
      keywords.forEach((k) => {
        if (!currentThread.topic_keywords.includes(k)) {
          currentThread.topic_keywords.push(k);
        }
      });
    } else {
      // Close current thread, start new one
      threads.push(currentThread);
      currentThread = {
        id: `THR-${Date.now().toString(36)}-${i}`,
        topic_keywords: keywords,
        prompts: [prompt],
        start_time: prompt.time,
        end_time: prompt.time,
        turn_count: 1,
      };
    }
  }

  if (currentThread) threads.push(currentThread);

  // Enrich threads with tool call data
  for (const thread of threads) {
    const threadStart = thread.start_time;
    const threadEnd = thread.end_time;
    const relevantCalls = toolCalls.filter((tc) => {
      const tcTime = tc.ts?.slice(11, 19) || "";
      return tcTime >= threadStart && tcTime <= threadEnd;
    });

    thread.tool_calls = relevantCalls.length;
    thread.tool_errors = relevantCalls.filter((tc) => !tc.success).length;
    thread.tools_used = [...new Set(relevantCalls.map((tc) => tc.tool))];
    thread.files_touched = [
      ...new Set(relevantCalls.map((tc) => tc.file).filter(Boolean)),
    ];

    // Cross-reference with tool keywords for better topic detection
    const toolKeywords = relevantCalls.flatMap((tc) => tc.keywords || []);
    toolKeywords.forEach((k) => {
      if (!thread.topic_keywords.includes(k)) {
        thread.topic_keywords.push(k);
      }
    });
  }

  return threads;
}

function timeToMinutes(timeStr) {
  const parts = timeStr.split(":");
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// ── Sentiment Detection ──────────────────────────────────

function detectSentiment(prompts) {
  let positive = 0;
  let negative = 0;
  let neutral = 0;

  for (const p of prompts) {
    const t = p.text.toLowerCase();
    if (
      /\b(perfect|great|yes|exactly|nice|good|thanks|awesome|love|works)\b/.test(
        t,
      )
    ) {
      positive++;
    } else if (
      /\b(no|wrong|not that|don't|stop|broken|fail|undo|revert|bad)\b/.test(t)
    ) {
      negative++;
    } else {
      neutral++;
    }
  }

  const total = positive + negative + neutral;
  if (total === 0) return "neutral";
  if (positive / total > 0.5) return "positive";
  if (negative / total > 0.3) return "negative";
  return "mixed";
}

// ── Enhancement Detection ────────────────────────────────

const INTENT_LABELS = {
  security: "security_audit",
  audit: "audit",
  build: "build",
  bug: "bug_fix",
  fix: "bug_fix",
  refactor: "refactor",
  spec: "spec_work",
  prd: "spec_work",
  stories: "spec_work",
  deploy: "deployment",
  test: "testing",
};

function detectEnhancements(thread) {
  const enhancements = new Set();
  for (const kw of thread.topic_keywords) {
    if (INTENT_LABELS[kw]) enhancements.add(INTENT_LABELS[kw]);
  }
  return [...enhancements];
}

// ── Assessment Scoring ───────────────────────────────────

function assessThread(thread) {
  const enhancements = detectEnhancements(thread);
  const sentiment = detectSentiment(thread.prompts);

  // Scoring signals
  const errorRate =
    thread.tool_calls > 0 ? thread.tool_errors / thread.tool_calls : 0;
  const isQuick = thread.turn_count <= 3;
  const isLong = thread.turn_count > 10;

  // Score: 0-1 (higher = more effective session)
  let score = 0.5; // baseline

  // Speed bonus
  if (isQuick) score += 0.2;
  if (isLong) score -= 0.1;

  // Error penalty
  if (errorRate > 0.3) score -= 0.2;
  if (errorRate < 0.1) score += 0.1;

  // Sentiment
  if (sentiment === "positive") score += 0.2;
  if (sentiment === "negative") score -= 0.2;

  score = Math.max(0, Math.min(1, score));

  return {
    thread_id: thread.id,
    topic: thread.topic_keywords.slice(0, 5).join(", "),
    enhancements,
    turns: thread.turn_count,
    tool_calls: thread.tool_calls,
    tool_errors: thread.tool_errors,
    sentiment,
    score: Math.round(score * 100) / 100,
    effective: score >= 0.6,
    signals: {
      speed: isQuick ? "fast" : isLong ? "slow" : "moderate",
      errors: errorRate < 0.1 ? "low" : errorRate < 0.3 ? "moderate" : "high",
      sentiment,
      depth:
        thread.turn_count <= 3
          ? "shallow"
          : thread.turn_count <= 8
            ? "moderate"
            : "deep",
    },
  };
}

// ── Haiku Learning Generator ────────────────────────────

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_TIMEOUT_MS = 10000;

function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY || process.env.JOBZOOKA_CLAUDE_KEY) {
    return process.env.ANTHROPIC_API_KEY || process.env.JOBZOOKA_CLAUDE_KEY;
  }
  for (const f of [".env.local", ".env"]) {
    try {
      const raw = fs.readFileSync(path.join(PROJECT, f), "utf8");
      const m = raw.match(
        /^(?:ANTHROPIC_API_KEY|JOBZOOKA_CLAUDE_KEY)\s*=\s*(.+)$/m,
      );
      if (m) return m[1].trim();
    } catch {
      /* skip */
    }
  }
  return null;
}

const ASSESS_SYSTEM = `You analyze Claude Code session data and generate SPECIFIC, ACTIONABLE learnings for a context injection system.

The context enhancer injects relevant learnings into every prompt Alex α (the AI assistant) receives. Your job: look at what happened in each conversation thread (topic, turns, errors, tools used, files touched, sentiment) and extract a learning that would help the context enhancer surface BETTER context next time.

Rules:
- Each learning must be specific to THIS project (Next.js app with multi-agent build system)
- Reference actual file paths, tools, or patterns observed
- Explain WHAT worked or didn't and WHY
- If a thread was fast with no errors, explain what made it efficient
- If a thread was slow or had errors, suggest what context should be injected next time
- Never generate generic learnings like "task completed quickly" — that's useless
- Each learning should be 1-2 sentences, max 60 words
- The "intent" field MUST be one of these exact values: security_audit, audit, build, bug_fix, refactor, spec_work, deployment, testing. Do NOT invent new intent names.
- Output valid JSON array of objects with: intent, tip, effective (boolean)`;

async function callHaikuForLearnings(assessments, threads) {
  const apiKey = loadApiKey();
  if (!apiKey) return null;

  const threadSummaries = threads.map((t, i) => {
    const a = assessments[i];
    return {
      topic: a?.topic || t.topic_keywords.join(", "),
      turns: t.turn_count,
      prompts: t.prompts.map((p) => p.text).slice(0, 5),
      tools_used: t.tools_used?.slice(0, 10) || [],
      files_touched: t.files_touched?.slice(0, 10) || [],
      tool_errors: t.tool_errors || 0,
      tool_calls: t.tool_calls || 0,
      sentiment: a?.sentiment || "neutral",
      score: a?.score || 0.5,
      effective: a?.effective ?? true,
      enhancements: a?.enhancements || [],
    };
  });

  const userMsg = `Analyze these session threads and generate learnings:\n\n${JSON.stringify(threadSummaries, null, 2)}\n\nReturn a JSON array of learnings. One learning per enhancement intent per thread (skip threads with no enhancements). Format: [{"intent": "bug_fix", "tip": "...", "effective": true}, ...]`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HAIKU_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1000,
        system: ASSESS_SYSTEM,
        messages: [{ role: "user", content: userMsg }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";

    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;

    // Validate and normalize each learning — reject ghost intents
    const VALID_INTENTS = new Set([
      "security_audit",
      "audit",
      "build",
      "bug_fix",
      "refactor",
      "spec_work",
      "deployment",
      "testing",
    ]);
    return parsed
      .filter(
        (l) =>
          l.intent &&
          l.tip &&
          typeof l.effective === "boolean" &&
          VALID_INTENTS.has(l.intent),
      )
      .map((l) => ({
        intent: String(l.intent),
        tip: String(l.tip).slice(0, 300),
        effective: l.effective,
      }));
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Static fallback (old behavior)
function generateStaticLearnings(assessments) {
  const learnings = [];
  for (const a of assessments) {
    if (a.enhancements.length === 0) continue;
    for (const enhancement of a.enhancements) {
      let tip = "";
      if (a.effective && a.signals.speed === "fast") {
        tip = `${enhancement} tasks completed quickly (${a.turns} turns) with ${a.signals.errors} errors. Topic: ${a.topic}`;
      } else if (!a.effective && a.signals.errors === "high") {
        tip = `${enhancement} had high error rate for "${a.topic}" — consider different approach`;
      } else if (!a.effective) {
        tip = `${enhancement} was less effective for "${a.topic}" (score: ${a.score})`;
      } else {
        tip = `${enhancement} worked for "${a.topic}" (score: ${a.score})`;
      }
      learnings.push({ intent: enhancement, tip, effective: a.effective });
    }
  }
  return learnings;
}

async function generateLearnings(assessments, threads) {
  // Try Haiku first for intelligent learnings
  const haikuLearnings = await callHaikuForLearnings(assessments, threads);
  const source = haikuLearnings ? "haiku" : "static";
  const rawLearnings = haikuLearnings || generateStaticLearnings(assessments);

  // Deduplicate against existing learnings
  const existing = readJSONL(LEARNINGS_FILE);
  const existingTips = new Set(existing.map((l) => l.tip));

  const learnings = rawLearnings
    .filter((l) => !existingTips.has(l.tip))
    .map((l) => ({
      ts: new Date().toISOString().slice(0, 10),
      intent: l.intent,
      tip: l.tip,
      effective: l.effective,
      score:
        assessments.find((a) => a.enhancements.includes(l.intent))?.score ||
        0.5,
      source,
    }));

  return learnings;
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  const prompts = parsePrompts();
  const toolCalls = readJSONL(TRACKING_FILE);

  if (prompts.length === 0) {
    console.log("assess-session: No prompts to assess");
    process.exit(0);
  }

  // Detect threads
  const threads = detectThreads(prompts, toolCalls);

  // Assess each thread
  const assessments = threads.map(assessThread);

  // Generate learnings (Haiku-powered with static fallback)
  const newLearnings = await generateLearnings(assessments, threads);

  // Write outputs
  try {
    // Save threads for debugging/review
    fs.writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2), "utf8");

    // Save assessments for monitoring
    fs.writeFileSync(
      ASSESSMENTS_FILE,
      JSON.stringify(assessments, null, 2),
      "utf8",
    );

    // Append learnings to memory
    if (newLearnings.length > 0) {
      fs.mkdirSync(path.dirname(LEARNINGS_FILE), { recursive: true });
      const lines =
        newLearnings.map((l) => JSON.stringify(l)).join("\n") + "\n";
      fs.appendFileSync(LEARNINGS_FILE, lines, "utf8");
    }

    // Summary
    const effective = assessments.filter((a) => a.effective).length;
    const total = assessments.length;
    const source = newLearnings[0]?.source || "none";
    console.log(
      `assess-session: ${threads.length} threads, ${total} assessed, ${effective} effective, ${newLearnings.length} learnings (${source})`,
    );

    // Print learnings
    for (const l of newLearnings) {
      const icon = l.effective ? "+" : "-";
      console.log(`  [${icon}] ${l.intent}: ${l.tip}`);
    }
  } catch (err) {
    console.error("assess-session error:", err.message);
  }
}

main().catch((err) => {
  console.error("assess-session fatal:", err.message);
  process.exit(1);
});
