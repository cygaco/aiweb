#!/usr/bin/env node
/**
 * Per-mode budget policy.
 */

const POLICY = {
  solo: { maxWallClockMinutes: 90, maxFixLoops: 2, maxProviderSpendUsd: 5, maxAgentCalls: 0 },
  adhoc: { maxWallClockMinutes: 240, maxFixLoops: 3, maxProviderSpendUsd: 5, maxAgentCalls: 12 },
  oneshot: { maxWallClockMinutes: 720, maxFixLoops: 3, maxProviderSpendUsd: 5, maxAgentCalls: 80 },
};

function check(mode, usage) {
  const policy = POLICY[mode || "adhoc"];
  const findings = [];
  if (!policy) return { ok: false, findings: ["unknown mode"] };
  const u = usage || {};
  for (const [key, max] of Object.entries(policy)) {
    if (typeof u[key] === "number" && u[key] > max) findings.push(`${key} ${u[key]} exceeds ${max}`);
  }
  return { ok: findings.length === 0, policy, findings };
}

if (require.main === module) {
  const mode = process.argv[2] || "adhoc";
  const result = check(mode, {});
  console.log(JSON.stringify({ mode, ...result }, null, 2));
  process.exit(result.ok ? 0 : 2);
}

module.exports = { POLICY, check };
