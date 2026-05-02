#!/usr/bin/env node
/**
 * OpenAI Deep Research orchestrator — 4-phase split to stay under 200k TPM.
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/one-off/research-openai.js <outdir>
 *
 * Reads <outdir>/brief.json. Writes <outdir>/openai-report.md.
 * Tries o3-deep-research first, falls back to o4-mini-deep-research.
 *
 * Each phase: max_tool_calls=12, 15-min poll timeout, 90s cooldown between phases.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const OUTDIR = process.argv[2];
if (!OUTDIR) {
  console.error("usage: node research-openai.js <outdir>");
  process.exit(2);
}

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("OPENAI_API_KEY not set — skipping OpenAI engine");
  process.exit(1);
}

const PHASE_NAMES = ["Landscape", "Mechanics", "Failure-Modes", "Contrarian"];
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const COOLDOWN_BETWEEN_PHASES_MS = 90 * 1000;

const briefPath = path.join(OUTDIR, "brief.json");
const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function postJson(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = body ? JSON.stringify(body) : "";
    const req = https.request(
      {
        method: body ? "POST" : "GET",
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
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

function buildPhaseInput(phaseIdx) {
  const p = brief.phases[phaseIdx];
  const prevPhases = brief.phases
    .slice(0, phaseIdx)
    .map((x) => `(Already researched) ${x.name}: ${x.objective}`)
    .join("\n");
  return [
    brief.research_question,
    "",
    brief.openai_instructions,
    "",
    "Focus on this specific research phase:",
    `${p.name}: ${p.objective}`,
    `  Questions: ${p.sub_questions.join("; ")}`,
    `  Evidence priorities: ${p.evidence_priorities}`,
    `  Stop when: ${p.stop_condition}`,
    prevPhases ? `\nContext from prior phases:\n${prevPhases}` : "",
    "",
    "Write a structured markdown report for this phase only. Include findings with claims, evidence, confidence levels (HIGH/MEDIUM/LOW), and source URLs.",
  ].join("\n");
}

async function runPhase(model, phaseIdx) {
  const phaseName = PHASE_NAMES[phaseIdx];
  log(`Phase ${phaseIdx + 1}/4: ${phaseName} (${model})...`);

  const input = buildPhaseInput(phaseIdx);
  const submitRes = await postJson(
    "https://api.openai.com/v1/responses",
    { Authorization: `Bearer ${API_KEY}` },
    {
      model,
      input,
      background: true,
      max_tool_calls: 12,
      tools: [{ type: "web_search_preview" }],
    },
  );

  if (submitRes.body?.error) {
    log(
      `  ${model} ${phaseName} immediate error: ${submitRes.body.error.message}`,
    );
    return { ok: false, error: submitRes.body.error.message };
  }
  const responseId = submitRes.body?.id;
  if (!responseId) {
    log(
      `  ${model} ${phaseName} — no response ID. Body: ${submitRes.raw.slice(0, 300)}`,
    );
    return { ok: false, error: "no_id" };
  }
  log(`  Started: ${responseId}`);

  const startTime = Date.now();
  let sleepInterval = 15 * 1000;

  // Initial 15s wait then check for fast async failure
  await sleep(15 * 1000);

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > POLL_TIMEOUT_MS) {
      log(
        `  ${phaseName} polling timeout after ${Math.round(elapsed / 1000)}s`,
      );
      return { ok: false, error: "timeout" };
    }

    const pollRes = await postJson(
      `https://api.openai.com/v1/responses/${responseId}`,
      { Authorization: `Bearer ${API_KEY}` },
    );

    if (pollRes.status === 429) {
      log("  rate-limited — backing off 60s");
      await sleep(60 * 1000);
      continue;
    }
    if (pollRes.status !== 200) {
      log(`  poll http ${pollRes.status} — retry in ${sleepInterval / 1000}s`);
      await sleep(sleepInterval);
      continue;
    }

    const status = pollRes.body?.status || "unknown";
    if (status === "completed") {
      let text = "";
      for (const item of pollRes.body.output || []) {
        if (item.type === "message") {
          for (const c of item.content || []) {
            if (c.type === "output_text") text += c.text + "\n";
          }
        }
      }
      log(
        `  ${phaseName} complete (${Math.round(elapsed / 1000)}s, ${text.length} chars)`,
      );
      return { ok: true, text };
    }
    if (status === "failed" || status === "expired" || status === "cancelled") {
      const errMsg =
        pollRes.body?.error?.message || pollRes.body?.error?.code || status;
      log(`  ${phaseName} ${status}: ${errMsg}`);
      // Save error log
      fs.writeFileSync(
        path.join(OUTDIR, `openai-error-${model}-phase${phaseIdx}.log`),
        JSON.stringify(pollRes.body, null, 2),
      );
      return { ok: false, error: `${status}: ${errMsg}` };
    }

    log(`  ${phaseName}: ${status} (${Math.round(elapsed / 1000)}s)`);
    await sleep(sleepInterval);
    if (sleepInterval < 60 * 1000) sleepInterval *= 2;
  }
}

async function runAllPhases(model) {
  log(`=== OpenAI 4-phase deep research with ${model} ===`);
  const phaseTexts = [];
  for (let i = 0; i < 4; i++) {
    const result = await runPhase(model, i);
    if (!result.ok) {
      log(`${model} failed on phase ${PHASE_NAMES[i]}: ${result.error}`);
      return { ok: false, lastPhase: i };
    }
    phaseTexts.push(result.text);
    if (i < 3) {
      log(
        `  Cooling down ${COOLDOWN_BETWEEN_PHASES_MS / 1000}s for TPM window...`,
      );
      await sleep(COOLDOWN_BETWEEN_PHASES_MS);
    }
  }
  const final = phaseTexts
    .map((t, i) => `## Phase ${i + 1}: ${PHASE_NAMES[i]}\n\n${t.trim()}`)
    .join("\n\n---\n\n");
  fs.writeFileSync(
    path.join(OUTDIR, "openai-report.md"),
    `# OpenAI Deep Research Report\n\n**Model:** ${model}\n**Date:** ${new Date().toISOString().slice(0, 10)}\n\n${final}\n`,
  );
  log(`OpenAI report written: ${final.length} chars`);
  return { ok: true };
}

(async () => {
  let result = await runAllPhases("o3-deep-research");
  if (!result.ok) {
    log("Falling back to o4-mini-deep-research...");
    result = await runAllPhases("o4-mini-deep-research");
  }
  if (!result.ok) {
    log("Both OpenAI deep research models failed.");
    process.exit(1);
  }
  log("OpenAI engine done.");
})().catch((e) => {
  log(`fatal: ${e.message}`);
  process.exit(1);
});
