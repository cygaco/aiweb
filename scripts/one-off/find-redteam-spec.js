// One-off: simulate dispatch-agent.js's findAgentSpec to confirm which redteam spec
// it picks up first. Run: node scripts/one-off/find-redteam-spec.js
const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");

const role = "redteam";
const agentsDir =
  PATHS.agents || path.join(PATHS.claudeDir || ".claude", "agents");
console.log("agentsDir:", agentsDir);
const stack = [agentsDir];
const found = [];
while (stack.length) {
  const dir = stack.pop();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) stack.push(full);
    else if (ent.isFile() && ent.name.endsWith(".md")) {
      const stem = ent.name.replace(/\.md$/, "");
      if (stem === role || stem === "orchestrator") {
        try {
          const body = fs.readFileSync(full, "utf8");
          const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch) {
            const nameMatch = fmMatch[1].match(/^name:\s*(\S+)/m);
            if (nameMatch && nameMatch[1] === role) found.push(full);
            else if (stem === role) found.push(full);
          } else if (stem === role) found.push(full);
        } catch {}
      }
    }
  }
}
console.log("matching specs (in scan order):");
for (const f of found) console.log(" ", f);
console.log("first match (what findAgentSpec returns):", found[0]);
