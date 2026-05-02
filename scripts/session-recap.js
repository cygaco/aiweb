#!/usr/bin/env node
/**
 * session-recap.js — pull last N user→assistant turns from events.jsonl
 * for catching back up after walking away.
 *
 * Usage: node scripts/session-recap.js [N]   (default N=3)
 *
 * Output: structured JSON the /session:recap skill renders to markdown.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { PATHS } = require("./hooks/lib/paths");

const N = Math.max(1, Math.min(parseInt(process.argv[2] || "3", 10), 10));

function readEvents() {
  if (!fs.existsSync(PATHS.eventsFile)) return [];
  const raw = fs.readFileSync(PATHS.eventsFile, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function findUserPrompts(events, n) {
  const prompts = [];
  for (let i = events.length - 1; i >= 0 && prompts.length < n; i--) {
    const e = events[i];
    if (e.cat === "prompt" && e.actor === "user") {
      prompts.push({ ...e, _index: i });
    }
  }
  return prompts.reverse(); // chronological order
}

// Phrases in the user's own message that flag something as unsolved.
const UNSOLVED_PATTERNS = [
  /\bstill\s+(?:not|broken|messed\s+up|seems|getting|see|have|fail|doesn'?t)/i,
  /\b0\s+(?:results?|jobs?|matches?|hits?)\b/i,
  /\bnot\s+(?:working|fixed|done|complete)\b/i,
  /\bbroken\b/i,
  /\bdoesn'?t\s+work\b/i,
  /\bcan'?t\s+(?:get|see|find|do)\b/i,
  /\b(?:fix|fixing|deferred|defer|todo|pending)\s+(?:this|that|it|the)\b/i,
  /\bwhy\s+(?:is|does|are|do|won'?t|doesn'?t)\b/i,
];

const USER_OPEN_QUESTION_RE = /\?\s*$|\?\s+(?:and|but|also|then)\b/i;

function detectUnsolvedInUserText(text) {
  const flagged = [];
  for (const re of UNSOLVED_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(text.length, m.index + m[0].length + 30);
      flagged.push(text.slice(start, end).trim().replace(/\s+/g, " "));
    }
  }
  // Multiple "?" suggests stacked questions
  const qCount = (text.match(/\?/g) || []).length;
  if (qCount >= 2) flagged.push(`(${qCount} questions stacked)`);
  // Imperatives at the end of a long prompt often slip past
  if (USER_OPEN_QUESTION_RE.test(text) && text.length > 100) {
    flagged.push("trailing question");
  }
  return [...new Set(flagged)].slice(0, 4);
}

function summarizeTurn(events, turn, nextTurnIndex) {
  const start = turn._index;
  const end = nextTurnIndex ?? events.length;
  const slice = events.slice(start + 1, end);

  const toolCounts = {};
  const filesEdited = new Set();
  const filesRead = new Set();
  const bashCommands = [];
  const blocks = [];
  const sendMessages = [];
  const betaReplies = [];
  const turnEnd = nextTurnIndex ? events[nextTurnIndex].ts : null;
  const turnStartTs = turn.ts;

  for (const e of slice) {
    if (e.cat === "tool" && e.actor === "alex") {
      const tool = e.data?.tool || "unknown";
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;

      if (tool === "Edit" || tool === "Write") {
        const f = (e.data?.file || "").split(/[\\/]/).slice(-3).join("/");
        if (f) filesEdited.add(f);
      } else if (tool === "Read") {
        const f = (e.data?.file || "").split(/[\\/]/).slice(-3).join("/");
        if (f) filesRead.add(f);
      } else if (tool === "Bash") {
        const cmd = (e.data?.file || "").split("\n")[0].slice(0, 80);
        if (cmd) bashCommands.push(cmd);
      } else if (tool === "SendMessage") {
        sendMessages.push({ ts: e.ts });
      }
    } else if (e.cat === "audit" && e.data?.action?.includes("blocked")) {
      blocks.push((e.data?.detail || "").slice(0, 100));
    } else if (e.cat === "inbox" && /beta|β/i.test(e.data?.from || "")) {
      betaReplies.push(e.ts);
    }
  }

  // Pending Beta consults = SendMessages with no inbox reply from Beta after them
  const pendingBetaConsults = sendMessages.filter((sm) => {
    return !betaReplies.some((rep) => rep > sm.ts);
  }).length;

  // Notes added in this window (mtime check on runtime/notes/*.md)
  const notesAdded = [];
  try {
    const notesDir = path.resolve(
      __dirname,
      "..",
      ".claude",
      "runtime",
      "notes",
    );
    const startMs = new Date(turnStartTs).getTime();
    const endMs = turnEnd ? new Date(turnEnd).getTime() : Date.now();
    for (const f of fs.readdirSync(notesDir)) {
      if (!f.endsWith(".md")) continue;
      const mtime = fs.statSync(path.join(notesDir, f)).mtimeMs;
      if (mtime >= startMs && mtime <= endMs) {
        notesAdded.push(f.replace(/\.md$/, ""));
      }
    }
  } catch {}

  const userText = turn.data?.stripped || turn.data?.raw || "";
  const userFlagged = detectUnsolvedInUserText(userText);

  return {
    ts: turn.ts,
    user: userText.slice(0, 300),
    userLength: turn.data?.length ?? 0,
    toolCounts,
    filesEdited: [...filesEdited].slice(0, 8),
    filesRead: [...filesRead].slice(0, 5),
    bashCommands: bashCommands.slice(0, 4),
    blocks: blocks.slice(0, 3),
    sendMessageCount: sendMessages.length,
    pendingBetaConsults,
    notesAdded,
    userFlagged,
    eventCount: slice.length,
  };
}

function getCommitsSince(ts) {
  if (!ts) return [];
  const sinceIso = new Date(ts).toISOString();
  const res = spawnSync(
    "git",
    ["log", `--since=${sinceIso}`, "--oneline", "--no-merges"],
    {
      encoding: "utf8",
    },
  );
  if (res.status !== 0) return [];
  return res.stdout.trim().split("\n").filter(Boolean).slice(0, 10);
}

function findPendingBetaConsults(events) {
  // Beta-decision events that never got a real answer. Beta directive
  // requested in the design call: surface these on resume so a stale
  // pending consult doesn't sit forgotten across sessions.
  const pending = [];
  for (const e of events) {
    if (e.cat !== "beta") continue;
    const answer = e.data?.answer || "";
    if (/^pending\b/i.test(answer)) {
      pending.push({
        ts: e.ts,
        question: (e.data?.question || "").slice(0, 140),
        category: e.data?.category || "?",
      });
    }
  }
  return pending;
}

function getCurrentState() {
  const branch =
    spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim() || "?";
  const status = spawnSync("git", ["status", "--short"], { encoding: "utf8" });
  const dirtyCount = status.stdout.split("\n").filter((l) => l.trim()).length;

  let mode = "?";
  try {
    const m = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "..", ".claude", "runtime", "mode.json"),
        "utf8",
      ),
    );
    mode = m.mode || "?";
  } catch {}

  // Open notes — list any topic files in runtime/notes/
  const notesDir = path.resolve(__dirname, "..", ".claude", "runtime", "notes");
  let openNotes = [];
  try {
    openNotes = fs
      .readdirSync(notesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {}

  return { branch, dirtyCount, mode, openNotes };
}

function minutesAgo(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function render(turns, currentState, lastTurnTs, pendingBeta) {
  const lines = [];
  lines.push(`## Session recap — last ${turns.length} turn(s)`);
  lines.push("");

  turns.forEach((t, i) => {
    const idx = turns.length - i;
    lines.push(`### Turn -${idx} (${minutesAgo(t.ts)})`);
    lines.push("");
    lines.push(`**You:** ${t.user.replace(/\n+/g, " ")}`);
    lines.push("");

    const did = [];
    if (t.filesEdited.length > 0) {
      did.push(
        `Edited ${t.filesEdited.length} file(s): ${t.filesEdited.join(", ")}`,
      );
    }
    if (t.bashCommands.length > 0) {
      did.push(`Ran: ${t.bashCommands.map((c) => `\`${c}\``).join(", ")}`);
    }
    const toolList = Object.entries(t.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}×${v}`)
      .join(", ");
    if (toolList) did.push(`Tools: ${toolList}`);
    if (t.sendMessageCount > 0)
      did.push(`Beta consults: ${t.sendMessageCount}`);
    if (t.blocks.length > 0) {
      did.push(`Blocked ${t.blocks.length}× (${t.blocks[0].slice(0, 50)}…)`);
    }

    if (did.length === 0) {
      lines.push(`**Did:** (just a chat message — no tools used)`);
    } else {
      did.forEach((line) => lines.push(`- ${line}`));
    }
    lines.push("");
  });

  // Aggregate pending / unsolved across the window
  const pendingLines = [];
  turns.forEach((t, i) => {
    const idx = turns.length - i;
    if (t.userFlagged.length > 0) {
      t.userFlagged.forEach((q) => {
        pendingLines.push(`- **Turn -${idx}**: you flagged "${q}"`);
      });
    }
    if (t.pendingBetaConsults > 0) {
      pendingLines.push(
        `- **Turn -${idx}**: ${t.pendingBetaConsults} Beta consult(s) sent without reply yet`,
      );
    }
    if (t.blocks.length > 0) {
      t.blocks.forEach((b) =>
        pendingLines.push(`- **Turn -${idx}**: hook block — ${b}`),
      );
    }
    if (t.notesAdded.length > 0) {
      t.notesAdded.forEach((n) =>
        pendingLines.push(
          `- **Turn -${idx}**: note appended to \`runtime/notes/${n}.md\``,
        ),
      );
    }
  });

  if (pendingLines.length > 0) {
    lines.push(`### Open / pending in this window`);
    pendingLines.forEach((l) => lines.push(l));
    lines.push("");
  }

  if (pendingBeta && pendingBeta.length > 0) {
    lines.push(`### Pending Beta consultations (cross-session)`);
    pendingBeta.slice(-5).forEach((p) => {
      lines.push(`- **${minutesAgo(p.ts)}** [${p.category}] ${p.question}`);
    });
    lines.push("");
  }

  const commits = getCommitsSince(turns[0]?.ts);
  if (commits.length > 0) {
    lines.push(`### Commits this window (${commits.length})`);
    commits.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  lines.push("### Current state");
  lines.push(`- Branch: \`${currentState.branch}\``);
  lines.push(`- Uncommitted: ${currentState.dirtyCount} file(s)`);
  lines.push(`- Mode: \`${currentState.mode}\``);
  if (currentState.openNotes.length > 0) {
    lines.push(
      `- Open note topics: ${currentState.openNotes.map((t) => `\`${t}\``).join(", ")}`,
    );
  }
  lines.push(`- Last turn: ${minutesAgo(lastTurnTs)}`);

  return lines.join("\n");
}

function main() {
  const events = readEvents();
  if (events.length === 0) {
    console.log("No events recorded yet — nothing to recap.");
    return;
  }
  const turns = findUserPrompts(events, N);
  if (turns.length === 0) {
    console.log("No user prompts found in events.jsonl.");
    return;
  }

  // Summarize each turn (window = from this prompt to the next, or end)
  const summaries = turns.map((turn, i) => {
    const nextIdx = i + 1 < turns.length ? turns[i + 1]._index : null;
    return summarizeTurn(events, turn, nextIdx);
  });

  const currentState = getCurrentState();
  const lastTurnTs = turns[turns.length - 1].ts;
  const pendingBeta = findPendingBetaConsults(events);
  console.log(render(summaries, currentState, lastTurnTs, pendingBeta));
}

main();
