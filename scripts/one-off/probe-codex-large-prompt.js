#!/usr/bin/env node
const fs = require("fs");
const { runProvider } = require("../hooks/lib/providers.js");

const promptFile =
  ".claude/runtime/dispatch/menu-delivery-discovery-reviewer-prompt.txt";
const prompt = fs.readFileSync(promptFile, "utf8");
console.log("prompt size:", prompt.length, "chars");
const start = Date.now();
const result = runProvider("reviewer", prompt, { timeoutMs: 600000 });
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log("elapsed:", elapsed, "s");
console.log("ok:", result.ok);
console.log("output_len:", result.output ? result.output.length : 0);
console.log(
  "output_first_400:",
  JSON.stringify((result.output || "").slice(0, 400)),
);
console.log("error:", (result.error || "none").slice(0, 600));
console.log("fallback:", result.fallback);
console.log("strictFailure:", result.strictFailure);
