const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const sp = path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json");
const store = JSON.parse(fs.readFileSync(sp, "utf8"));

const MAP = {
  shell: "shell",
  profile: "profile",
  auth: "auth",
  rockets: "rockets-economy",
  onboarding: "onboarding",
  "market-research": "market-research",
  "deep-dive-qa": "deep-dive-qa",
  "skills-curation": "skills-curation",
  competitiveness: "competitiveness",
  "resume-generation": "resume-generation",
  linkedin: "linkedin",
  extension: "extension",
  "auto-apply": "auto-apply",
  "deus-mechanicus": "deus-mechanicus",
  backend: "backend",
};

function extractSection13Files(prdPath) {
  if (!fs.existsSync(prdPath)) return null;
  const txt = fs.readFileSync(prdPath, "utf8");
  const lines = txt.split(/\r?\n/);
  let inSec = false;
  const buf = [];
  for (const L of lines) {
    if (/^#{1,6}\s+(Section\s+)?13[\s.:]/i.test(L)) {
      inSec = true;
      continue;
    }
    if (inSec) {
      if (/^#{1,3}\s+(Section\s+)?\d+[\s.:]/i.test(L)) break;
      buf.push(L);
    }
  }
  if (!inSec) return null;
  const sectionTxt = buf.join("\n");
  const fileRe =
    /(?:`|'|"|\s|\(|\[|^)((?:src|extension|services|packages|ops|\.github)\/[\w./\-@]+\.[a-zA-Z0-9]+)/g;
  const found = new Set();
  let m;
  while ((m = fileRe.exec(sectionTxt))) found.add(m[1]);
  return Array.from(found).sort();
}

const log = [];
let totalAdds = 0;
let totalRemoves = 0;

for (const [feat, fdef] of Object.entries(store.features)) {
  if (feat.startsWith("foundation-")) continue;
  const docsDir = MAP[feat];
  if (!docsDir) {
    log.push({ feat, status: "no-mapping" });
    continue;
  }
  const prdPath = path.join(ROOT, "requirements/05-features", docsDir, "PRD.md");
  const prdFiles = extractSection13Files(prdPath);
  if (prdFiles === null) {
    log.push({ feat, prdPath, status: "no-section-13" });
    continue;
  }
  const storeFiles = (fdef.files || []).slice().sort();
  const prdSet = new Set(prdFiles);
  const storeSet = new Set(storeFiles);
  const adds = prdFiles.filter((f) => !storeSet.has(f));
  const removes = storeFiles.filter((f) => !prdSet.has(f));
  log.push({
    feat,
    docsDir,
    prdCount: prdFiles.length,
    storeCount: storeFiles.length,
    adds,
    removes,
  });
  totalAdds += adds.length;
  totalRemoves += removes.length;
  fdef.files = prdFiles;
}

const isApply = process.argv.includes("--apply");
if (isApply) {
  fs.writeFileSync(sp, JSON.stringify(store, null, 2));
  console.log("STORE UPDATED");
}
console.log(
  JSON.stringify({ apply: isApply, totalAdds, totalRemoves, log }, null, 2),
);
