#!/usr/bin/env node
/**
 * Alpha-driven gauntlet: bypasses Gamma when Gamma's dispatch route is broken.
 * Runs reviewer + compliance + qa sequentially via runProvider (which has the
 * Windows-stdin fix from LRN-2026-04-17-n).
 */
const fs = require("fs");
const path = require("path");
const { runProvider } = require("../hooks/lib/providers.js");

const ROOT = path.resolve(__dirname, "..", "..");
const DISPATCH_DIR = path.join(ROOT, ".claude", "runtime", "dispatch");
const FEATURE = "menu-delivery-discovery";

const ROLES = ["reviewer", "compliance", "qa"];

(async () => {
  const summary = {};
  for (const role of ROLES) {
    const promptPath = path.join(DISPATCH_DIR, `${FEATURE}-${role}-prompt.txt`);
    const outputPath = path.join(
      DISPATCH_DIR,
      `${FEATURE}-${role}-output.json`,
    );

    if (!fs.existsSync(promptPath)) {
      console.error(`[skip ${role}] prompt missing: ${promptPath}`);
      summary[role] = { ok: false, reason: "prompt missing" };
      continue;
    }

    const prompt = fs.readFileSync(promptPath, "utf8");
    console.log(
      `[${role}] dispatching — prompt ${prompt.length} chars, model from manifest, timeout 600s`,
    );
    const start = Date.now();
    const result = runProvider(role, prompt, { timeoutMs: 600000 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          ok: result.ok,
          provider: result.provider,
          model: result.model,
          actualModel: result.actualModel,
          output: result.output,
          error: result.error || null,
          elapsed_s: Number(elapsed),
        },
        null,
        2,
      ),
    );

    const outLen = result.output ? result.output.length : 0;
    console.log(
      `[${role}] ok=${result.ok} elapsed=${elapsed}s output=${outLen}c → ${path.basename(outputPath)}`,
    );
    summary[role] = {
      ok: result.ok,
      elapsed_s: Number(elapsed),
      output_chars: outLen,
      error: result.error || null,
    };
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
})();
