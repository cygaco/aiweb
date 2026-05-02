const fs = require("fs");
const p = ".claude/agents/02-oneshot/.system/store.json";
const s = JSON.parse(fs.readFileSync(p, "utf8"));
console.log(JSON.stringify(s.heartbeat, null, 2));
console.log("fixAttempts:", s.features["market-research"].fixAttempts);
console.log("status:", s.features["market-research"].status);
