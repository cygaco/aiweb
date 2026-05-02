/**
 * Shared human-facing report shape for WarpOS commands.
 */

const ORDER = [
  "verdict",
  "whatChanged",
  "why",
  "risksRemaining",
  "whatWasRejected",
  "whatWasTested",
  "needsHumanDecision",
  "recommendedNextAction",
];

const LABELS = {
  verdict: "Verdict",
  whatChanged: "What changed",
  why: "Why",
  risksRemaining: "Risks remaining",
  whatWasRejected: "What was rejected",
  whatWasTested: "What was tested",
  needsHumanDecision: "What needs human decision",
  recommendedNextAction: "Recommended next action",
};

function list(value) {
  if (value == null) return ["None."];
  if (Array.isArray(value)) return value.length ? value.map(String) : ["None."];
  return [String(value)];
}

function renderHumanReport(title, report) {
  const lines = [`${title} report`];
  for (const key of ORDER) {
    lines.push(``);
    lines.push(`${LABELS[key]}:`);
    for (const item of list(report[key])) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

function printHumanReport(title, report) {
  console.log("");
  console.log(renderHumanReport(title, report));
}

module.exports = { ORDER, LABELS, renderHumanReport, printHumanReport };
