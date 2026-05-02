#!/usr/bin/env node
/**
 * Gemini Deep Research orchestrator — Interactions API (deep-research-pro-preview-12-2025).
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/one-off/research-gemini.js <outdir>
 *
 * Reads <outdir>/brief.json. Writes <outdir>/gemini-report.md.
 * Falls back to OAuth token from ~/.gemini/oauth_creds.json if no API key.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const OUTDIR = process.argv[2];
if (!OUTDIR) {
  console.error("usage: node research-gemini.js <outdir>");
  process.exit(2);
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function getAuth() {
  if (process.env.GEMINI_API_KEY) {
    return {
      type: "key",
      header: { "x-goog-api-key": process.env.GEMINI_API_KEY },
    };
  }
  if (process.env.GOOGLE_API_KEY) {
    return {
      type: "key",
      header: { "x-goog-api-key": process.env.GOOGLE_API_KEY },
    };
  }
  try {
    const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    if (Date.now() < creds.expiry_date) {
      return {
        type: "oauth",
        header: { Authorization: `Bearer ${creds.access_token}` },
      };
    }
    log("OAuth token expired");
  } catch (e) {
    log(`No OAuth: ${e.message}`);
  }
  return null;
}

const auth = getAuth();
if (!auth) {
  log("NO_GEMINI_AUTH — set GEMINI_API_KEY or run gemini auth login");
  process.exit(1);
}
log(`Using ${auth.type} auth`);

const briefPath = path.join(OUTDIR, "brief.json");
const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function request(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = body ? JSON.stringify(body) : "";
    const reqHeaders = { ...headers };
    if (body) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(data);
    }
    const req = https.request(
      {
        method,
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: reqHeaders,
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            const j = chunks ? JSON.parse(chunks) : {};
            resolve({ status: res.statusCode, body: j, raw: chunks });
          } catch (e) {
            resolve({ status: res.statusCode, body: null, raw: chunks });
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(data);
    req.end();
  });
}

const phasesText = brief.phases
  .map(
    (p) =>
      `${p.name}: ${p.objective}\n  Questions: ${p.sub_questions.join("; ")}\n  Evidence: ${p.evidence_priorities}\n  Stop when: ${p.stop_condition}`,
  )
  .join("\n\n");

const input = `${brief.research_question}\n\n${brief.gemini_instructions}\n\nResearch Phases:\n${phasesText}\n\nOutput format: ${JSON.stringify(brief.required_output_schema)}`;

const payload = {
  input,
  agent: "deep-research-pro-preview-12-2025",
  background: true,
  store: true,
};

(async () => {
  log("Submitting Gemini Deep Research interaction...");
  const submitRes = await request(
    "POST",
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    auth.header,
    payload,
  );

  if (submitRes.status !== 200) {
    log(
      `Submit failed http ${submitRes.status}: ${submitRes.raw.slice(0, 400)}`,
    );
    fs.writeFileSync(path.join(OUTDIR, "gemini-error.log"), submitRes.raw);
    process.exit(1);
  }
  const interactionId = submitRes.body?.id;
  if (!interactionId) {
    log(`No interaction ID. Body: ${submitRes.raw.slice(0, 400)}`);
    fs.writeFileSync(path.join(OUTDIR, "gemini-error.log"), submitRes.raw);
    process.exit(1);
  }
  log(`Started: ${interactionId}`);

  const POLL_TIMEOUT_MS = 45 * 60 * 1000;
  const startTime = Date.now();
  let sleepInterval = 15 * 1000;

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > POLL_TIMEOUT_MS) {
      log(`Gemini polling timeout after ${Math.round(elapsed / 1000)}s`);
      process.exit(1);
    }

    const pollRes = await request(
      "GET",
      `https://generativelanguage.googleapis.com/v1beta/interactions/${interactionId}`,
      auth.header,
      null,
    );

    if (pollRes.status === 429) {
      log("rate-limited — backing off 60s");
      await sleep(60 * 1000);
      continue;
    }
    if (pollRes.status !== 200) {
      log(`poll http ${pollRes.status} — retry in ${sleepInterval / 1000}s`);
      await sleep(sleepInterval);
      continue;
    }

    const status = pollRes.body?.status || "unknown";
    if (status === "completed") {
      const outputs = pollRes.body.outputs || [];
      const last = outputs[outputs.length - 1];
      const text = last?.text || "";
      fs.writeFileSync(
        path.join(OUTDIR, "gemini-report.md"),
        `# Gemini Deep Research Report\n\n**Date:** ${new Date().toISOString().slice(0, 10)}\n\n${text}\n`,
      );
      log(
        `Gemini report written: ${text.length} chars (${Math.round(elapsed / 1000)}s)`,
      );
      return;
    }
    if (status === "failed" || status === "cancelled") {
      log(`Gemini ${status}`);
      fs.writeFileSync(
        path.join(OUTDIR, "gemini-error.log"),
        JSON.stringify(pollRes.body, null, 2),
      );
      process.exit(1);
    }

    log(`Gemini: ${status} (${Math.round(elapsed / 1000)}s)`);
    await sleep(sleepInterval);
    if (sleepInterval < 60 * 1000) sleepInterval *= 2;
  }
})().catch((e) => {
  log(`fatal: ${e.message}`);
  process.exit(1);
});
