// scripts/one-off-classify-stubs.js
// Classify each non-foundation feature file as: missing | already-stub | real
// Output: JSON summary + per-file detail
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const store = require(
  path.join(ROOT, ".claude/agents/02-oneshot/.system/store.json"),
);

const STUB_MARKERS = [
  /SKELETON:/,
  /SKELETON not implemented/i,
  /not implemented/i,
];

function classify(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs))
    return { state: "missing", lines: 0, hasMarker: false };
  const txt = fs.readFileSync(abs, "utf8");
  const lines = txt.split(/\r?\n/).length;
  const hasMarker = STUB_MARKERS.some((re) => re.test(txt));
  // Heuristics:
  //   component (.tsx in src/components/): <30 lines + marker = stub
  //   route (route.ts under api/): <15 lines + (501 status or marker)
  //   lib (.ts in src/lib/): functions throw "not implemented" pattern OR very short with marker
  //   other: marker or very short
  let state;
  const isComp = /src[\\/]components[\\/]/.test(rel) && rel.endsWith(".tsx");
  const isRoute =
    /src[\\/]app[\\/]api[\\/].*route\.ts$/.test(rel) ||
    /src[\\/]app[\\/].*[\\/]route\.ts$/.test(rel);
  const isLib = /src[\\/]lib[\\/]/.test(rel) && rel.endsWith(".ts");
  if (isComp) {
    state = lines < 30 && hasMarker ? "already-stub" : "real";
  } else if (isRoute) {
    state =
      lines < 20 && (hasMarker || /501/.test(txt)) ? "already-stub" : "real";
  } else if (isLib) {
    // libs that throw SKELETON consistently are stubs; libs with type-only exports are foundation-like (but these aren't foundation)
    const throwsAll = /throw new Error\(["'`]SKELETON/.test(txt);
    state = throwsAll || (lines < 30 && hasMarker) ? "already-stub" : "real";
  } else {
    state = lines < 30 && hasMarker ? "already-stub" : "real";
  }
  return { state, lines, hasMarker };
}

const out = { real: [], alreadyStub: [], missing: [] };

for (const [feat, fdef] of Object.entries(store.features)) {
  if (feat.startsWith("foundation-")) continue;
  if (feat === "backend") {
    // skip — greenfield
    continue;
  }
  for (const rel of fdef.files || []) {
    const c = classify(rel);
    const entry = { feat, rel, ...c };
    if (c.state === "real") out.real.push(entry);
    else if (c.state === "already-stub") out.alreadyStub.push(entry);
    else out.missing.push(entry);
  }
}

console.log(
  JSON.stringify(
    {
      realCount: out.real.length,
      alreadyStubCount: out.alreadyStub.length,
      missingCount: out.missing.length,
      real: out.real,
      alreadyStub: out.alreadyStub,
      missing: out.missing,
    },
    null,
    2,
  ),
);
