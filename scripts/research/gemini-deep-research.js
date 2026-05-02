#!/usr/bin/env node
// Usage: node gemini-deep-research.js <outdir>
// Runs Gemini Deep Research via Interactions API. Reads GEMINI_API_KEY or GOOGLE_API_KEY.
// Falls back to OAuth token from ~/.gemini/oauth_creds.json.
// Writes <outdir>/gemini-report.md on success.

const fs = require("fs");
const os = require("os");
const path = require("path");

const outdir = process.argv[2];
if (!outdir) {
  console.error("Usage: node gemini-deep-research.js <outdir>");
  process.exit(1);
}

function logLine(s) {
  const t = new Date().toISOString().slice(11, 19);
  process.stdout.write("[" + t + "] " + s + "\n");
}

let authHeaders = null;
if (process.env.GEMINI_API_KEY) {
  authHeaders = { "x-goog-api-key": process.env.GEMINI_API_KEY };
} else if (process.env.GOOGLE_API_KEY) {
  authHeaders = { "x-goog-api-key": process.env.GOOGLE_API_KEY };
} else {
  try {
    const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    if (Date.now() < creds.expiry_date) {
      authHeaders = { Authorization: "Bearer " + creds.access_token };
    }
  } catch (e) {}
}

if (!authHeaders) {
  logLine("NO_GEMINI_AUTH — skipping");
  process.exit(2);
}

const tmpDir = path.join(outdir, ".tmp");
fs.mkdirSync(tmpDir, { recursive: true });
const brief = JSON.parse(
  fs.readFileSync(path.join(outdir, "brief.json"), "utf8"),
);

const MAX_SECONDS = 2700;
const POLL_INITIAL = 15;
const POLL_MAX = 60;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const phasesText = brief.phases
    .map(
      (p) =>
        p.name +
        ": " +
        p.objective +
        "\n  Questions: " +
        p.sub_questions.join("; ") +
        "\n  Evidence: " +
        p.evidence_priorities +
        "\n  Stop when: " +
        p.stop_condition,
    )
    .join("\n\n");

  const payload = {
    input:
      brief.research_question +
      "\n\n" +
      brief.gemini_instructions +
      "\n\nResearch Phases:\n" +
      phasesText +
      "\n\nOutput format: " +
      JSON.stringify(brief.required_output_schema),
    agent: "deep-research-pro-preview-12-2025",
    background: true,
    store: true,
  };

  logLine("Submitting Gemini Deep Research...");
  const submitRes = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const submitText = await submitRes.text();
  let submitData;
  try {
    submitData = JSON.parse(submitText);
  } catch (e) {
    logLine("Invalid submit response: " + submitText.slice(0, 300));
    process.exit(3);
  }

  if (!submitData.id) {
    logLine(
      "Failed to create interaction. Response: " + submitText.slice(0, 500),
    );
    process.exit(3);
  }

  const interactionId = submitData.id;
  logLine("Started: " + interactionId);

  // Save ID for crash recovery
  const sessionPath = path.join(outdir, ".session.json");
  let session = {};
  try {
    session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  } catch (e) {}
  session.gemini_id = interactionId;
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

  const startTime = Date.now();
  let pollInterval = POLL_INITIAL;

  while (true) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed > MAX_SECONDS) {
      logLine("Polling timeout after " + MAX_SECONDS + "s");
      process.exit(4);
    }

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions/" +
        interactionId,
      { headers: authHeaders },
    );

    if (res.status === 429) {
      logLine("Rate limited — backing off 60s");
      await sleep(60000);
      continue;
    } else if (res.status !== 200) {
      logLine("HTTP " + res.status + " — retry");
      await sleep(pollInterval * 1000);
      continue;
    }

    const data = await res.json();
    const status = data.status || "unknown";

    if (status === "completed") {
      const outputs = data.outputs || [];
      const last = outputs[outputs.length - 1];
      const text = last ? last.text || "" : "";
      fs.writeFileSync(path.join(outdir, "gemini-report.md"), text);
      logLine(
        "Gemini Deep Research complete (" +
          elapsed +
          "s, " +
          text.length +
          " chars)",
      );
      process.exit(0);
    } else if (status === "failed" || status === "cancelled") {
      logLine("Gemini failed: " + status);
      fs.writeFileSync(
        path.join(outdir, "gemini-error.log"),
        JSON.stringify(data, null, 2),
      );
      process.exit(5);
    }

    logLine("Gemini: " + status + " (" + elapsed + "s)");
    await sleep(pollInterval * 1000);
    if (pollInterval < POLL_MAX)
      pollInterval = Math.min(POLL_MAX, pollInterval * 2);
  }
})().catch((e) => {
  logLine("FATAL: " + e.message);
  process.exit(99);
});
