#!/usr/bin/env node
/**
 * drift-verify.js
 *
 * For each pending high+medium entry, check whether spec_excerpt is locatable
 * in the spec_file and whether the suggested edit makes sense.
 *
 * Outputs JSON to stdout: { id, feature, drift_type, confidence, spec_file,
 *   excerpt_found, edit_kind, can_apply, old_value, new_value, reason }
 *
 * edit_kind:
 *   - "literal_replace" — edit_how shows "replaced: X → Y"; we can replace X with Y inside excerpt
 *   - "value_change" — suggested_update is "Value X changed to Y in code"
 *   - "removed_block" — code removed; spec needs no textual edit
 *   - "unknown"
 *
 * can_apply: true only for clean cases where:
 *   - excerpt is found in spec_file
 *   - the X→Y values are short/clean (no rgba blobs, no full HTML/JSX blocks)
 *   - the X value appears inside the excerpt (so we know where to apply)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(
  ROOT,
  ".claude/project/events/requirements-staged.jsonl",
);
const filter = (process.argv[2] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const driftFilter = (process.argv[3] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const lines = fs.readFileSync(FILE, "utf8").trim().split(/\r?\n/);
const byId = new Map();
const statusUpdates = [];
for (const L of lines) {
  if (!L.trim()) continue;
  let e;
  try {
    e = JSON.parse(L);
  } catch {
    continue;
  }
  if (e.type === "status_update") {
    statusUpdates.push(e);
    continue;
  }
  byId.set(e.id, e);
}
for (const su of statusUpdates) {
  const orig = byId.get(su.id);
  if (orig) {
    orig.data = orig.data || {};
    orig.data.status = su.status;
  }
}

const pending = [];
for (const e of byId.values()) {
  const s = (e.data && e.data.status) || e.status || "unknown";
  if (s !== "pending") continue;
  if (filter.length) {
    const c = (e.data && e.data.confidence) || "unknown";
    if (!filter.includes(c)) continue;
  }
  if (driftFilter.length) {
    const t = (e.data && e.data.drift_type) || "unknown";
    if (!driftFilter.includes(t)) continue;
  }
  pending.push(e);
}

const specCache = new Map();
function readSpec(p) {
  if (specCache.has(p)) return specCache.get(p);
  const full = path.join(ROOT, p);
  let s = "";
  try {
    s = fs.readFileSync(full, "utf8");
  } catch (err) {
    s = null;
  }
  specCache.set(p, s);
  return s;
}

function classifyEdit(d) {
  const eh = d.edit_how || "";
  const su = d.suggested_update || "";

  // "Value X changed to Y in code"
  const m = su.match(/^Value "(.+?)" changed to "(.+?)" in code/s);
  let valOld = null,
    valNew = null;
  if (m) {
    valOld = m[1];
    valNew = m[2];
  }

  // "replaced: X → Y" or "replaced: X →\nY"
  const rm = eh.match(/^replaced:\s*([\s\S]*?)\s*→\s*([\s\S]*)$/);
  let replOld = null,
    replNew = null;
  if (rm) {
    replOld = rm[1];
    replNew = rm[2];
  }

  if (eh.startsWith("removed block:") || eh.startsWith("removed:")) {
    return { kind: "removed_block", valOld, valNew };
  }
  if (replOld && replNew) {
    return { kind: "literal_replace", replOld, replNew, valOld, valNew };
  }
  if (valOld && valNew) {
    return { kind: "value_change", valOld, valNew };
  }
  return { kind: "unknown", valOld, valNew };
}

function isClean(s) {
  if (!s) return false;
  if (s.length > 80) return false;
  if (/<\/?\w/.test(s)) return false; // contains JSX/HTML tags
  if (/[{}]/.test(s)) return false;
  if (/rgba\(|var\(--/.test(s)) return false;
  return true;
}

const results = [];
for (const e of pending) {
  const d = e.data || {};
  const spec = readSpec(d.spec_file);
  const excerpt = d.spec_excerpt || "";
  const excerptFound = spec
    ? spec.includes(excerpt) && excerpt.length > 0
    : false;

  const cls = classifyEdit(d);
  let canApply = false;
  let reason = "";

  if (!spec) {
    reason = "spec file missing";
  } else if (!excerptFound) {
    reason = "spec_excerpt not found";
  } else if (cls.kind === "removed_block") {
    reason = "code block removed; suggested update bogus (e.g. none→primary)";
    canApply = false;
  } else if (cls.kind === "value_change") {
    if (!isClean(cls.valOld) || !isClean(cls.valNew)) {
      reason = "value strings unclean (CSS/JSX)";
    } else if (!excerpt.includes(cls.valOld)) {
      reason = `valOld "${cls.valOld}" not in excerpt`;
    } else {
      canApply = true;
      reason = "clean value-change inside excerpt";
    }
  } else if (cls.kind === "literal_replace") {
    if (!isClean(cls.replOld) || !isClean(cls.replNew)) {
      reason = "replacement strings unclean (CSS/JSX/long)";
    } else if (excerpt.includes(cls.replOld)) {
      canApply = true;
      reason = "literal_replace inside excerpt";
    } else if (
      cls.valOld &&
      cls.valNew &&
      isClean(cls.valOld) &&
      isClean(cls.valNew) &&
      excerpt.includes(cls.valOld)
    ) {
      canApply = true;
      reason = "value-change derived from replace, inside excerpt";
    } else {
      reason = "no clean way to apply edit to excerpt";
    }
  } else {
    reason = "unknown edit kind";
  }

  results.push({
    id: e.id,
    feature: d.feature,
    drift_type: d.drift_type,
    confidence: d.confidence,
    spec_file: d.spec_file,
    excerpt_found: excerptFound,
    edit_kind: cls.kind,
    can_apply: canApply,
    old_value:
      cls.kind === "literal_replace"
        ? cls.replOld
        : cls.kind === "value_change"
          ? cls.valOld
          : null,
    new_value:
      cls.kind === "literal_replace"
        ? cls.replNew
        : cls.kind === "value_change"
          ? cls.valNew
          : null,
    fallback_old: cls.valOld,
    fallback_new: cls.valNew,
    reason,
  });
}

process.stdout.write(JSON.stringify(results, null, 2));
