#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const role = process.argv[2] || "reviewer";
const prefix = process.argv[3] || "menu-discovery";
const file = path.join(
  ".claude",
  "runtime",
  "dispatch",
  `${prefix}-${role}-output.json`,
);

if (!fs.existsSync(file)) {
  console.log(`[no output yet]: ${file}`);
  process.exit(0);
}
const stat = fs.statSync(file);
console.log(`size: ${stat.size}`);
const raw = fs.readFileSync(file, "utf8");
let r;
try {
  r = JSON.parse(raw);
} catch (e) {
  console.log(`[invalid JSON]: ${e.message}`);
  console.log(`first 500 chars: ${raw.slice(0, 500)}`);
  process.exit(0);
}
console.log(`ok: ${r.ok}`);
console.log(`provider: ${r.provider} | model: ${r.model || r.specModel}`);
console.log(`fallback: ${r.fallback || false}`);
console.log(`error: ${r.error || "(none)"}`);
console.log(`output len: ${(r.output || "").length}`);
if (r.parsed) {
  console.log(`parsed verdict: ${r.parsed.verdict || r.parsed.pass}`);
  console.log(`parsed score: ${r.parsed.score}`);
  if (r.parsed.blocking_issues) {
    console.log(`blocking_issues: ${r.parsed.blocking_issues.length}`);
    for (const b of r.parsed.blocking_issues.slice(0, 20))
      console.log(` - ${b}`);
  }
  if (r.parsed.violations) {
    console.log(`violations: ${r.parsed.violations.length}`);
    for (const v of r.parsed.violations.slice(0, 20))
      console.log(
        ` - ${typeof v === "string" ? v : JSON.stringify(v).slice(0, 200)}`,
      );
  }
  if (r.parsed.droppedRequirements) {
    console.log(`droppedRequirements: ${r.parsed.droppedRequirements.length}`);
    for (const d of r.parsed.droppedRequirements.slice(0, 20))
      console.log(
        ` - ${typeof d === "string" ? d : JSON.stringify(d).slice(0, 200)}`,
      );
  }
  if (r.parsed.phantomCompletions) {
    console.log(`phantomCompletions: ${r.parsed.phantomCompletions.length}`);
    for (const p of r.parsed.phantomCompletions.slice(0, 20))
      console.log(
        ` - ${typeof p === "string" ? p : JSON.stringify(p).slice(0, 200)}`,
      );
  }
  if (r.parsed.findings) {
    console.log(`findings: ${r.parsed.findings.length}`);
    for (const f of r.parsed.findings.slice(0, 20))
      console.log(
        ` - ${typeof f === "string" ? f : JSON.stringify(f).slice(0, 200)}`,
      );
  }
  if (r.parsed.vulnerabilities) {
    console.log(`vulnerabilities: ${r.parsed.vulnerabilities.length}`);
    for (const v of r.parsed.vulnerabilities.slice(0, 20))
      console.log(
        ` - ${typeof v === "string" ? v : JSON.stringify(v).slice(0, 200)}`,
      );
  }
  if (r.parsed.warnings) console.log(`warnings: ${r.parsed.warnings.length}`);
  if (r.parsed.suggested_fixes) {
    console.log(`suggested_fixes: ${r.parsed.suggested_fixes.length}`);
    for (const s of r.parsed.suggested_fixes.slice(0, 10))
      console.log(
        ` - ${typeof s === "string" ? s : JSON.stringify(s).slice(0, 200)}`,
      );
  }
}
if (r.envelopeValidation) {
  console.log(`envelope.ok: ${r.envelopeValidation.ok}`);
  if (r.envelopeValidation.errors?.length)
    console.log(
      `envelope.errors: ${JSON.stringify(r.envelopeValidation.errors)}`,
    );
}
