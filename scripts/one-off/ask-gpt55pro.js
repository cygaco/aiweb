#!/usr/bin/env node
/**
 * ask-gpt55pro.js — One-off direct OpenAI Responses-API consultation.
 *
 * The codex CLI (ChatGPT-account auth) only exposes gpt-5.5 on this account,
 * not the gpt-5.5-pro extended-reasoning tier. gpt-5.5-pro is reachable only
 * via the platform API (/v1/responses), so this script talks to the API
 * directly using OPENAI_API_KEY from the repo-root .env. It does NOT use the
 * codex/gemini CLIs, so it does not touch the dispatch-route guard surface.
 *
 * Usage:
 *   node scripts/one-off/ask-gpt55pro.js check
 *       → list models relevant to the request; report whether gpt-5.5-pro exists
 *   node scripts/one-off/ask-gpt55pro.js ask <prompt-file> <out-file>
 *       → submit prompt to gpt-5.5-pro at reasoning effort xhigh, poll, write answer
 *
 * Env overrides:
 *   ASK_MODEL                 (default gpt-5.5-pro)
 *   ASK_EFFORT                (default xhigh)
 *   ASK_MAX_OUTPUT_TOKENS     (default 32000 — bounds cost under the autonomy <$5 line)
 *
 * Cost guard: max_output_tokens caps reasoning+visible output. At a premium
 * $120/M-output assumption, 32000 tokens ≈ $3.84; input is a few K tokens. So a
 * single run stays under the $5 ask-first threshold by construction.
 */

const fs = require("fs");
const path = require("path");

// ── Load OPENAI_API_KEY from env or repo-root .env (value never logged) ──
function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const envPath = path.join(__dirname, "..", "..", ".env");
  const txt = fs.readFileSync(envPath, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^OPENAI_API_KEY=(.*)$/);
    if (m) return m[1].trim();
  }
  throw new Error("OPENAI_API_KEY not found in env or .env");
}

const API_KEY = loadKey();
const MODE = process.argv[2] || "check";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listModels() {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: "Bearer " + API_KEY },
  });
  const data = await res.json();
  if (data.error) {
    console.error("models error:", data.error.message);
    process.exit(1);
  }
  const ids = (data.data || []).map((m) => m.id).sort();
  const rel = ids.filter((id) => /gpt-5|o[0-9]|pro/.test(id));
  console.log("total models on this key:", ids.length);
  console.log("relevant (gpt-5* / o* / *pro*):");
  for (const id of rel) console.log("  " + id);
  console.log("");
  console.log("gpt-5.5-pro present:", ids.includes("gpt-5.5-pro"));
  console.log("gpt-5.5 present:", ids.includes("gpt-5.5"));
}

function collectText(pd) {
  let text = "";
  for (const item of pd.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text") text += c.text;
      }
    }
  }
  return text;
}

// One submit+poll attempt. Returns { ok, text, pd } | { rateLimited:true } |
// { fatal:string }. Rate-limit failures are surfaced (not exited) so the
// caller can resubmit a fresh request in a later TPM window.
async function attempt(input, model, effort, maxOut) {
  const submitRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      reasoning: { effort },
      max_output_tokens: maxOut,
      background: true,
      store: true,
    }),
  });
  const sub = await submitRes.json();
  if (sub.error) {
    if (sub.error.code === "rate_limit_exceeded") return { rateLimited: true };
    return { fatal: sub.error.message || sub.error.code };
  }
  if (!sub.id) return { fatal: "no response id" };
  console.log(
    `submitted ${sub.id}  model=${model}  effort=${effort}  max_output=${maxOut}  status=${sub.status}`,
  );

  const start = Date.now();
  const TIMEOUT_MS = 9 * 60 * 1000;
  let interval = 10000;
  await sleep(12000);

  while (true) {
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (Date.now() - start > TIMEOUT_MS) return { fatal: "poll timeout" };
    const pr = await fetch("https://api.openai.com/v1/responses/" + sub.id, {
      headers: { Authorization: "Bearer " + API_KEY },
    });
    if (pr.status === 429) {
      await sleep(15000);
      continue;
    }
    if (pr.status !== 200) {
      await sleep(interval);
      continue;
    }
    const pd = await pr.json();
    const status = pd.status || "unknown";

    if (status === "completed" || status === "incomplete") {
      return { ok: true, text: collectText(pd), pd, status };
    }
    if (status === "failed" || status === "cancelled" || status === "expired") {
      const code = pd.error && pd.error.code;
      if (code === "rate_limit_exceeded") return { rateLimited: true };
      return { fatal: status + ": " + JSON.stringify(pd.error || {}) };
    }
    console.log(`  ${status} (${elapsed}s)`);
    await sleep(interval);
    if (interval < 30000) interval += 5000;
  }
}

async function ask(promptFile, outFile) {
  if (!promptFile || !outFile) {
    console.error("usage: ask <prompt-file> <out-file>");
    process.exit(2);
  }
  const input = fs.readFileSync(promptFile, "utf8");
  const model = process.env.ASK_MODEL || "gpt-5.5-pro";
  const effort = process.env.ASK_EFFORT || "xhigh";
  const maxOut = parseInt(process.env.ASK_MAX_OUTPUT_TOKENS || "32000", 10);
  const maxRetries = parseInt(process.env.ASK_RATE_LIMIT_RETRIES || "3", 10);

  let res;
  for (let i = 0; i <= maxRetries; i++) {
    res = await attempt(input, model, effort, maxOut);
    if (!res.rateLimited) break;
    const wait = 30000 + i * 15000;
    console.log(
      `  rate_limit_exceeded — resubmitting in ${wait / 1000}s (attempt ${i + 2}/${maxRetries + 1})`,
    );
    await sleep(wait);
  }

  if (res.fatal) {
    console.error("FAILED:", res.fatal);
    process.exit(3);
  }
  if (res.rateLimited) {
    console.error(
      "FAILED: rate_limit_exceeded persisted across retries. This org's TPM for",
      model,
      "is too low for these settings. Lower ASK_MAX_OUTPUT_TOKENS / ASK_EFFORT, or raise the account TPM tier.",
    );
    process.exit(4);
  }

  const u = res.pd.usage || {};
  const reasoningTok = (u.output_tokens_details || {}).reasoning_tokens;
  if (res.text) fs.writeFileSync(outFile, res.text);
  console.log(res.status.toUpperCase());
  console.log(
    `usage: input=${u.input_tokens} output=${u.output_tokens} reasoning=${reasoningTok}`,
  );
  if (res.status === "incomplete") {
    console.log(
      "incomplete reason:",
      JSON.stringify(res.pd.incomplete_details || {}),
    );
  }
  console.log("answer chars:", res.text.length, "→", outFile);
  process.exit(res.text ? 0 : 3);
}

(async () => {
  if (MODE === "check") await listModels();
  else if (MODE === "ask") await ask(process.argv[3], process.argv[4]);
  else {
    console.error("unknown mode:", MODE);
    process.exit(2);
  }
})().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
