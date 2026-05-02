#!/usr/bin/env node
// Usage: node openai-build-phase.js <outdir> <phase_idx> <model>
// Reads brief.json, writes <outdir>/.tmp/phase-input.txt and <outdir>/.tmp/openai-payload.json

const fs = require("fs");
const path = require("path");

const [, , outdir, phaseIdxStr, model] = process.argv;
if (!outdir || phaseIdxStr === undefined || !model) {
  console.error(
    "Usage: node openai-build-phase.js <outdir> <phase_idx> <model>",
  );
  process.exit(1);
}
const phaseIdx = parseInt(phaseIdxStr, 10);
const brief = JSON.parse(
  fs.readFileSync(path.join(outdir, "brief.json"), "utf8"),
);
const p = brief.phases[phaseIdx];
const prevPhases = brief.phases
  .slice(0, phaseIdx)
  .map((x) => "(Already researched) " + x.name + ": " + x.objective)
  .join("\n");

const input =
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
  "\n\nWrite a structured markdown report for this phase only. Include findings with claims, evidence, confidence levels, and source URLs.";

const tmpDir = path.join(outdir, ".tmp");
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(path.join(tmpDir, "phase-input.txt"), input);

const payload = {
  model,
  input,
  background: true,
  max_tool_calls: 12,
  tools: [{ type: "web_search_preview" }],
};
fs.writeFileSync(
  path.join(tmpDir, "openai-payload.json"),
  JSON.stringify(payload),
);
console.log(
  "OK phase=" + phaseIdx + " model=" + model + " bytes=" + input.length,
);
