#!/usr/bin/env node
// Append HIGH-confidence learnings from /research:deep run to learnings.jsonl
// Idempotent: skips entries whose `id` already exists in the file.

const fs = require("fs");
const path = require("path");

const LEARNINGS_FILE = ".claude/project/memory/learnings.jsonl";
const SOURCE = "deep-research/backend-best-practices-security";
const TS = "2026-04-23";

const learnings = [
  {
    id: "L-2026-04-23-research-upstash-ec-only",
    tip: "Upstash Redis explicitly documents Eventual Consistency as the only guarantee and has deprecated Strong Consistency mode. The Lua-script ledger is node-atomic but a leader failover can silently lose the last few hundred ms of writes. For Stripe webhook idempotency + rocket ledger, move financial state to Postgres (Graphile Worker for transactional enqueue); keep Redis for cache/rate-limit/scratch. Verified verbatim at upstash.com/docs/redis/features/consistency.",
    importance: "high",
  },
  {
    id: "L-2026-04-23-research-cf-origin-secret-weak",
    tip: 'The Cloudflare-Origin-Secret header pattern + CF-IP allowlist is strictly weaker than Authenticated Origin Pulls (mTLS) with per-zone custom cert. Bypassable via the "using Cloudflare to bypass Cloudflare" attack (Certitude) — attacker proxies through their own CF zone. Use AOP with per-zone cert (NOT the shared CF cert). Keep Origin-Secret as defense-in-depth, not the gate. Verified.',
    importance: "high",
  },
  {
    id: "L-2026-04-23-research-hono-fly-sigterm",
    tip: 'Hono on Node+Fly drops in-flight requests on every deploy unless SIGTERM is wired explicitly. Defaults: kill_timeout=5s, kill_signal=SIGINT, @hono/node-server has no built-in drain. For the worker process group set kill_timeout=300, kill_signal=SIGTERM, auto_stop_machines=false, use CMD ["node", ...] (NOT npm start — shell parents swallow signals), and write a drain handler that stops accepting QStash deliveries, checkpoints in-flight Claude calls, then server.close() with a 10s failsafe. Verified via Hono #3756.',
    importance: "high",
  },
  {
    id: "L-2026-04-23-research-qstash-rotation-footgun",
    tip: "QStash CURRENT/NEXT signing-key rotation has a verbatim documented footgun: rolling keys twice without redeploying both keys to all envs first locks out ALL webhooks (both keys replaced). Add a Redis flag qstash:last_rotation_deployed_at; gate the admin rotate button on it being <24h old. Verified at upstash.com/docs/qstash/howto/roll-signing-keys.",
    importance: "high",
  },
  {
    id: "L-2026-04-23-research-claude-injection-numbers",
    tip: "Anthropic Gray Swan benchmark for Claude Opus 4.5: 1.4% direct attack success in browser-use; Sonnet 4.5: 10.8%. Indirect injection via uploaded documents (e.g. PDF resume): ~50% in multi-attempt scenarios per ODU 2026 paper. CVE-2025-54794 (CVSS 7.7) and CVE-2025-54795 (CVSS 8.7) are real in-the-wild against Claude tool surfaces. wrapUntrustedData() nonce-wrapping is mitigation-not-prevention. Architect for blast-radius containment: scoped Redis token for worker, action proposals reviewed by main API (no direct Stripe/ledger writes from Claude output), audit-log every input+output, optional Haiku second-pass classifier on output.",
    importance: "high",
  },
  {
    id: "L-2026-04-23-research-three-state-lua-canonical",
    tip: "Canonical three-state idempotency in Upstash Redis Lua (CLAIM/SKIP/DONE) requires: HGET state, if false set processing+claimed_at + TTL; if processing check claimed_at age and steal at >60s (prevents permanent lockout on worker crash); if done return DONE. Side-effects MUST be independently idempotent (Stripe API idempotency keys, INSERT ON CONFLICT) because stolen claims can run side-effects twice. EVALSHA only — REST pipeline is in-order but NOT atomic.",
    importance: "high",
  },
  {
    id: "L-2026-04-23-research-webauthn-recovery",
    tip: 'WebAuthn-only admin without recovery is a documented lockout class (Auth0 dashboard 2025). Enforce ≥2 passkeys + 10 hashed one-time recovery codes per admin AT registration. Recovery codes in Postgres, not Redis (must survive Redis failover). NO email magic-link fallback (defeats phishing resistance). Verify-only step-up endpoint (does NOT extend session) is the right pattern but framework support is genuinely thin (better-auth #8071 still open) — implement from primitives, bind challenge to action content digest like sha256("refund:userId:amount:nonce").',
    importance: "high",
  },
  {
    id: "L-2026-04-23-research-admin-tailscale-separation",
    tip: "Co-locating admin panel with public API in same Hono process is a structural smell (three-engine consensus). Recommended: separate Fly app jobzooka-admin with [services] bound to [flycast] internal only, Tailscale ACL gates access to admin group. Passkey + scope become defense-in-depth on top of network-layer isolation. Public API has zero admin routes — even on full compromise no mint-refund button to find. Cost: ~$5/mo extra Fly app + Tailscale free tier.",
    importance: "medium",
  },
  {
    id: "L-2026-04-23-research-anthropic-prompt-caching",
    tip: "At ≥1k DAU, Anthropic Prompt Caching (90% input cost reduction on cached tokens) and Batch API (50% off async workloads) become mandatory cost controls — without them, Claude spend dominates the rest of the stack budget. Cache the system prompt + canonical context (job-board taxonomy, profile schema, etc.) which rarely change.",
    importance: "medium",
  },
  {
    id: "L-2026-04-23-research-extension-discovery-pinning",
    tip: "Chrome MV3 manifest is cryptographically signed but /.well-known/api-config runtime discovery breaks that commitment — a compromised .well-known (DNS takeover, CDN misconfig, BGP hijack) silently re-points all extensions to attacker-controlled API. Fix: sign .well-known content with extension-embedded pubkey OR demote it to deprecation-banner-only role with prod URL hardcoded in manifest.",
    importance: "medium",
  },
  {
    id: "L-2026-04-23-research-redis-stream-not-compliance",
    tip: 'Redis Streams (XADD MAXLEN ~) are NOT compliance-grade audit. Last few entries can vanish in leader failover (per Upstash EC). For Stripe-related audit (charges, debits, admin actions, auth events) use either Postgres append-only partitioned table + nightly archive to R2 with object-lock, OR direct write to S3/R2 with object-lock. Redis stream OK for ops UI (last 1k events for admin panel) but NOT for "prove what happened to Stripe."',
    importance: "high",
  },
];

// Read existing IDs to dedupe
const existing = new Set();
if (fs.existsSync(LEARNINGS_FILE)) {
  const lines = fs
    .readFileSync(LEARNINGS_FILE, "utf8")
    .split("\n")
    .filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.id) existing.add(obj.id);
    } catch {}
  }
}

let appended = 0;
const out = fs.createWriteStream(LEARNINGS_FILE, { flags: "a" });
for (const l of learnings) {
  if (existing.has(l.id)) continue;
  const entry = {
    id: l.id,
    ts: TS,
    intent: "external",
    tip: l.tip,
    effective: null,
    pending_validation: true,
    score: 0,
    source: SOURCE,
    importance: l.importance,
  };
  out.write(JSON.stringify(entry) + "\n");
  appended++;
}
out.end();
console.log(
  "Appended " +
    appended +
    " learnings (skipped " +
    (learnings.length - appended) +
    " duplicates).",
);
