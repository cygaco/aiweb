#!/usr/bin/env node
// Usage: node openai-deep-research.js <outdir>
// Runs 4-phase OpenAI deep research with model fallback. Reads OPENAI_API_KEY from env.
// Writes <outdir>/openai-report.md on success.

const fs = require("fs");
const path = require("path");

const outdir = process.argv[2];
if (!outdir) {
  console.error("Usage: node openai-deep-research.js <outdir>");
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY not set — skipping");
  process.exit(2);
}

const tmpDir = path.join(outdir, ".tmp");
fs.mkdirSync(tmpDir, { recursive: true });
const brief = JSON.parse(
  fs.readFileSync(path.join(outdir, "brief.json"), "utf8"),
);

const PHASE_NAMES = ["Landscape", "Mechanics", "Failure-Modes", "Contrarian"];
const MAX_PHASE_SECONDS = 900;
const MAX_TOTAL_SECONDS = 60 * 60; // 1 hour total per model attempt
const COOLDOWN_SECONDS = 90;
const POLL_INITIAL = 15;
const POLL_MAX = 60;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function logLine(s) {
  const t = new Date().toISOString().slice(11, 19);
  process.stdout.write("[" + t + "] " + s + "\n");
}

function buildPhaseInput(phaseIdx) {
  const p = brief.phases[phaseIdx];
  const prevPhases = brief.phases
    .slice(0, phaseIdx)
    .map((x) => "(Already researched) " + x.name + ": " + x.objective)
    .join("\n");
  return (
    brief.research_question +
    "\n\n" +
    brief.openai_instructions +
    "\n\nFocus on this specific research phase:\n" +
    p.name +
    ": " +
    p.objective +
    "\n  Questions: " +
    p.sub_questions.join("; ") +
    "\n  Evidence priorities: " +
    p.evidence_priorities +
    "\n  Stop when: " +
    p.stop_condition +
    (prevPhases ? "\n\nContext from prior phases:\n" + prevPhases : "") +
    "\n\nWrite a structured markdown report for this phase only. Include findings with claims, evidence, confidence levels, and source URLs."
  );
}

async function submitPhase(model, phaseIdx) {
  const input = buildPhaseInput(phaseIdx);
  const payload = {
    model,
    input,
    background: true,
    max_tool_calls: 12,
    tools: [{ type: "web_search_preview" }],
  };
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: "Invalid JSON: " + text.slice(0, 200) };
  }
  if (data.error) return { error: data.error.message || data.error.code };
  if (!data.id) return { error: "No response ID" };
  return { id: data.id };
}

async function pollPhase(responseId, phaseName) {
  const startTime = Date.now();
  let pollInterval = POLL_INITIAL;

  while (true) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed > MAX_PHASE_SECONDS) {
      return { error: "Polling timeout after " + MAX_PHASE_SECONDS + "s" };
    }

    const res = await fetch(
      "https://api.openai.com/v1/responses/" + responseId,
      {
        headers: { Authorization: "Bearer " + apiKey },
      },
    );

    if (res.status === 429) {
      logLine("  rate limited — backing off 60s");
      await sleep(60000);
      continue;
    } else if (res.status !== 200) {
      logLine("  HTTP " + res.status + " — retry in " + pollInterval + "s");
      await sleep(pollInterval * 1000);
      continue;
    }

    const data = await res.json();
    const status = data.status || "unknown";

    if (status === "completed") {
      let text = "";
      for (const item of data.output || []) {
        if (item.type === "message") {
          for (const c of item.content || []) {
            if (c.type === "output_text") text += c.text + "\n";
          }
        }
      }
      logLine(
        "  " +
          phaseName +
          " complete (" +
          elapsed +
          "s, " +
          text.length +
          " chars)",
      );
      return { text };
    } else if (
      status === "failed" ||
      status === "expired" ||
      status === "cancelled"
    ) {
      const err =
        (data.error && (data.error.message || data.error.code)) || status;
      return { error: status + ": " + err, raw: data };
    }

    logLine("  " + phaseName + ": " + status + " (" + elapsed + "s)");
    await sleep(pollInterval * 1000);
    if (pollInterval < POLL_MAX)
      pollInterval = Math.min(POLL_MAX, pollInterval * 2);
  }
}

async function runAllPhases(model, totalStartTime) {
  logLine("=== OpenAI 4-phase deep research with " + model + " ===");

  for (let i = 0; i < 4; i++) {
    if ((Date.now() - totalStartTime) / 1000 > MAX_TOTAL_SECONDS) {
      logLine("  TOTAL timeout exceeded — aborting " + model);
      return false;
    }

    const phaseName = PHASE_NAMES[i];
    logLine("  Phase " + (i + 1) + "/4: " + phaseName + " (" + model + ")...");

    const submission = await submitPhase(model, i);
    if (submission.error) {
      logLine("  " + phaseName + " immediate error: " + submission.error);
      return false;
    }
    logLine("  Started: " + submission.id);

    // Wait 15s before first poll to detect async failures
    await sleep(15000);

    const result = await pollPhase(submission.id, phaseName);
    if (result.error) {
      logLine("  " + phaseName + " failed: " + result.error);
      const errFile = path.join(
        outdir,
        "openai-error-" + model + "-phase" + i + ".log",
      );
      fs.writeFileSync(errFile, JSON.stringify(result.raw || {}, null, 2));
      return false;
    }

    fs.writeFileSync(
      path.join(tmpDir, "openai-phase-" + i + ".md"),
      result.text,
    );

    if (i < 3) {
      logLine("  Waiting " + COOLDOWN_SECONDS + "s for TPM window reset...");
      await sleep(COOLDOWN_SECONDS * 1000);
    }
  }

  // Assemble
  const phases = [];
  for (let i = 0; i < 4; i++) {
    const f = path.join(tmpDir, "openai-phase-" + i + ".md");
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, "utf8").trim();
      if (content) phases.push(content);
    }
  }
  fs.writeFileSync(
    path.join(outdir, "openai-report.md"),
    phases.join("\n\n---\n\n"),
  );
  logLine("OpenAI report assembled from " + phases.length + " phases");
  return true;
}

(async () => {
  const totalStart = Date.now();
  const ok =
    (await runAllPhases("o3-deep-research", totalStart)) ||
    (await runAllPhases("o4-mini-deep-research", totalStart));
  if (!ok) {
    logLine("Both OpenAI deep research models failed.");
    process.exit(3);
  }
  logLine("OpenAI deep research SUCCESS");
})().catch((e) => {
  logLine("FATAL: " + e.message);
  process.exit(4);
});
