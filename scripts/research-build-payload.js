#!/usr/bin/env node
// Helper for /research:deep — builds API payloads for OpenAI/Gemini engines
// Usage:
//   node scripts/research-build-payload.js openai-phase <outdir> <phase_idx> <model>
//   node scripts/research-build-payload.js gemini-payload <outdir>
//   node scripts/research-build-payload.js openai-extract <outdir> <phase_idx>
//   node scripts/research-build-payload.js gemini-extract <outdir>
//   node scripts/research-build-payload.js assemble-openai <outdir>

const fs = require("fs");
const path = require("path");

const cmd = process.argv[2];
const outdir = process.argv[3];

function loadBrief() {
  return JSON.parse(fs.readFileSync(path.join(outdir, "brief.json"), "utf8"));
}

if (cmd === "openai-phase") {
  const phaseIdx = parseInt(process.argv[4], 10);
  const model = process.argv[5];
  const brief = loadBrief();
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
    "\n\nWrite a structured markdown report for this phase only. Include findings with claims, evidence, confidence levels, and source URLs. Cite specific 2025/2026 sources where possible.";
  const payload = {
    model,
    input,
    background: true,
    max_tool_calls: 12,
    tools: [{ type: "web_search_preview" }],
  };
  fs.writeFileSync(
    path.join(outdir, ".tmp/openai-payload.json"),
    JSON.stringify(payload),
  );
  console.log(
    "Wrote openai-payload.json (" + JSON.stringify(payload).length + " bytes)",
  );
} else if (cmd === "openai-extract") {
  const phaseIdx = parseInt(process.argv[4], 10);
  const d = JSON.parse(
    fs.readFileSync(path.join(outdir, ".tmp/openai-result.json"), "utf8"),
  );
  let text = "";
  for (const item of d.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text") text += c.text + "\n";
      }
    }
  }
  fs.writeFileSync(
    path.join(outdir, ".tmp/openai-phase-" + phaseIdx + ".md"),
    text,
  );
  console.log("Extracted phase " + phaseIdx + " (" + text.length + " chars)");
} else if (cmd === "assemble-openai") {
  const phases = [0, 1, 2, 3]
    .map((i) => {
      const f = path.join(outdir, ".tmp/openai-phase-" + i + ".md");
      return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "";
    })
    .filter(Boolean);
  fs.writeFileSync(
    path.join(outdir, "openai-report.md"),
    phases.join("\n\n---\n\n"),
  );
  console.log("Assembled OpenAI report from " + phases.length + " phases");
} else if (cmd === "gemini-payload") {
  const brief = loadBrief();
  const phases = brief.phases
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
      phases +
      "\n\nOutput format: " +
      JSON.stringify(brief.required_output_schema),
    agent: "deep-research-pro-preview-12-2025",
    background: true,
    store: true,
  };
  fs.writeFileSync(
    path.join(outdir, ".tmp/gemini-payload.json"),
    JSON.stringify(payload),
  );
  console.log(
    "Wrote gemini-payload.json (" + JSON.stringify(payload).length + " bytes)",
  );
} else if (cmd === "gemini-extract") {
  const d = JSON.parse(
    fs.readFileSync(path.join(outdir, ".tmp/gemini-result.json"), "utf8"),
  );
  const outputs = d.outputs || [];
  const last = outputs[outputs.length - 1];
  fs.writeFileSync(
    path.join(outdir, "gemini-report.md"),
    last ? last.text || "" : "",
  );
  console.log(
    "Extracted gemini report (" +
      (last ? (last.text || "").length : 0) +
      " chars)",
  );
} else if (cmd === "status") {
  const f = path.join(outdir, ".tmp", process.argv[4]);
  if (!fs.existsSync(f)) {
    console.log("FILE_MISSING");
    process.exit(0);
  }
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    console.log(d.status || "unknown");
  } catch (e) {
    console.log("parse_error");
  }
} else if (cmd === "extract-id") {
  const f = path.join(outdir, ".tmp", process.argv[4]);
  if (!fs.existsSync(f)) {
    console.log("");
    process.exit(0);
  }
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    console.log(d.id || "");
  } catch (e) {
    console.log("");
  }
} else {
  console.error("Unknown command: " + cmd);
  process.exit(1);
}
