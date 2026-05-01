#!/usr/bin/env node

/**
 * edit-watcher.js — Runs automatically on every Edit/Write (PostToolUse hook)
 *
 * When any file is edited, this hook checks if it matters and does 4 things:
 *
 *   1. EVENT LOG — Records what changed to paths.events/events.jsonl
 *      so session handoffs and retros can see what happened.
 *
 *   2. STALENESS — Looks up SPEC_GRAPH.json to find docs that depend on
 *      the edited file. Stamps those docs with <!-- STALE --> banners
 *      so you know they need review.
 *
 *   3. DRIFT DETECTION — Checks if the edit introduced values that conflict
 *      with FIELD_REGISTRY.json (the canonical value definitions).
 *
 *   4. FILE DISCOVERY — If a new file type appears in requirements/05-features/,
 *      auto-registers it in SPEC_GRAPH.json so future edits propagate.
 *
 * Only fires for files matching SPEC_PATTERNS (docs, hooks, key lib files,
 * extension, globals.css). Other files pass through silently.
 *
 * Previously named: pulse-core.js
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");
const { log: centralLog, getSessionId } = require("./lib/logger");

// ── Load manifest for project-specific config ──
let manifest = {};
try {
  manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "manifest.json"), "utf8"),
  );
} catch {
  /* manifest missing — use defaults */
}

// Canonical data files — paths from manifest or sensible defaults
const canonicalDir = manifest.canonical_dir
  ? path.join(PROJECT, manifest.canonical_dir)
  : path.join(PROJECT, "docs", "00-canonical");
const SPEC_GRAPH_FILE = path.join(canonicalDir, "SPEC_GRAPH.json");
const FIELD_REGISTRY_FILE = path.join(canonicalDir, "FIELD_REGISTRY.json");
const PRECEDENCE_FILE = path.join(canonicalDir, "PRECEDENCE.json");
const MODE_FILE = path.join(canonicalDir, "MODE.json");

// ── Spec file patterns — from manifest or defaults ──
// Default patterns are framework-generic (docs, CLAUDE.md, agents, hooks)
const DEFAULT_SPEC_PATTERNS = [
  /^docs\//,
  /^requirements\//,
  /^CLAUDE\.md$/,
  /^\.claude\/commands\//,
  /^\.claude\/agents\//,
  /^scripts\/hooks\//,
];

let SPEC_PATTERNS = DEFAULT_SPEC_PATTERNS;
if (
  Array.isArray(manifest.spec_patterns) &&
  manifest.spec_patterns.length > 0
) {
  // Manifest provides string patterns — convert to RegExp
  SPEC_PATTERNS = manifest.spec_patterns.map((p) => new RegExp(p));
} else if (manifest.foundation_files) {
  // If foundation_files defined, add them as spec patterns
  const foundationPatterns = (manifest.foundation_files || []).map(
    (f) => new RegExp("^" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
  );
  SPEC_PATTERNS = [...DEFAULT_SPEC_PATTERNS, ...foundationPatterns];
}

// ── Code patterns — from manifest or defaults ──
const DEFAULT_CODE_PATTERNS = [/^src\/components\//, /^src\/app\//];
let CODE_PATTERNS = DEFAULT_CODE_PATTERNS;
if (
  Array.isArray(manifest.code_patterns) &&
  manifest.code_patterns.length > 0
) {
  CODE_PATTERNS = manifest.code_patterns.map((p) => new RegExp(p));
}

// ── Component → feature mapping — from manifest or empty ──
// Empty map means code tracking works but without feature attribution
const COMPONENT_FEATURE_MAP = manifest.component_feature_map || {};

// Spec layer detection from file path
function detectLayer(rel) {
  if (/\/PRD\.md$/.test(rel)) return "prd";
  if (/\/HL-STORIES\.md$/.test(rel)) return "hl-story";
  if (/\/STORIES\.md$/.test(rel)) return "story";
  if (/\/INPUTS\.md$/.test(rel)) return "inputs";
  if (/\/COPY\.md$/.test(rel)) return "copy";
  if (/^docs\/01-design-system\//.test(rel)) return "design-system";
  if (/^docs\/04-architecture\//.test(rel)) return "architecture";
  if (/^docs\/00-canonical\/fixtures\//.test(rel)) return "fixture";
  if (/^docs\/00-canonical\//.test(rel)) return "canonical";
  if (/^scripts\/hooks\//.test(rel)) return "hook";
  if (/^src\//.test(rel)) return "code";
  return "other";
}

// Extract component name from code file path
function extractComponent(rel) {
  const m = rel.match(/\/([A-Z][A-Za-z0-9]+)\.(tsx|ts)$/);
  return m ? m[1] : null;
}

// Extract step number from component name
function extractStep(component) {
  if (!component) return null;
  const m = component.match(/Step(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Detect scope of change (edit vs rewrite vs create)
function detectScope(toolName, oldStr, newStr) {
  if (toolName === "Write") return "rewrite";
  if (!oldStr) return "create";
  // Rough heuristic: if old and new differ significantly in length, it's a rewrite
  const ratio =
    Math.min(oldStr.length, newStr.length) /
    Math.max(oldStr.length, newStr.length || 1);
  return ratio < 0.3 ? "rewrite" : "edit";
}

// Build a "how" description from the diff
function buildHow(toolName, oldStr, newStr) {
  if (toolName === "Write") {
    // For Write, extract purpose from first comment or heading
    const firstLine = (newStr || "").split("\n").find((l) => l.trim()) || "";
    return `full rewrite — ${truncate(firstLine, 100)}`;
  }
  if (!oldStr && newStr) return `added: ${truncate(newStr, 150)}`;
  if (oldStr && !newStr) return `removed: ${truncate(oldStr, 150)}`;
  // Both present — describe the replacement
  const oldSnip = truncate(oldStr, 60);
  const newSnip = truncate(newStr, 60);
  if (oldStr.length > newStr.length * 2) return `removed block: ${oldSnip}`;
  if (newStr.length > oldStr.length * 2) return `added block: ${newSnip}`;
  return `replaced: ${oldSnip} → ${newSnip}`;
}

// Look backward for recent user prompt to extract "why"
function findRecentWhy() {
  try {
    const { query } = require("./lib/logger");
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const prompts = query({ cat: "prompt", since: fiveMinAgo, limit: 3 });
    if (prompts.length > 0) {
      const last = prompts[prompts.length - 1];
      const raw = last.data?.stripped || last.data?.raw || "";
      // Skip system-generated prompts
      if (raw.startsWith("/") || raw.length < 5) return null;
      return truncate(raw, 150);
    }
  } catch {
    /* best-effort */
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────

function isSpecFile(rel) {
  return SPEC_PATTERNS.some((p) => p.test(rel));
}

function isCodeFile(rel) {
  return CODE_PATTERNS.some((p) => p.test(rel));
}

function truncate(str, max) {
  if (!str) return "";
  const oneLine = str.replace(/\n/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 3) + "...";
}

function isoNow() {
  return new Date().toISOString().slice(0, 19);
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function getMode() {
  const m = readJSON(MODE_FILE);
  return m?.mode || "light";
}

// ── Event Counter (for unique IDs within session) ────────

let _evtCounter = 0;
function nextEventId() {
  _evtCounter++;
  const ts = Date.now().toString(36);
  return `EVT-${ts}-${_evtCounter}`;
}

// ── Group Detection (edits within 60s to same feature = same group) ──

const GROUP_WINDOW_MS = 60000;
let _lastGroup = { feature: "", ts: 0, id: "" };

function getGroupId(feature) {
  const now = Date.now();
  if (feature === _lastGroup.feature && now - _lastGroup.ts < GROUP_WINDOW_MS) {
    _lastGroup.ts = now;
    return _lastGroup.id;
  }
  const gid = `CS-${Date.now().toString(36)}`;
  _lastGroup = { feature, ts: now, id: gid };
  return gid;
}

// ── Requirement Drift Staging ────────────────────────────

const SPEC_FILE_NAMES = ["STORIES.md", "INPUTS.md", "PRD.md", "COPY.md"];
const FEATURES_DIR = manifest.features_dir
  ? path.join(PROJECT, manifest.features_dir)
  : path.join(PROJECT, "requirements", "05-features");

// Cache spec file contents by path+mtime to avoid re-reading
const _specCache = new Map();

function readSpecCached(specPath) {
  try {
    const stat = fs.statSync(specPath);
    const key = specPath + "|" + stat.mtimeMs;
    if (_specCache.has(key)) return _specCache.get(key);
    const content = fs.readFileSync(specPath, "utf8");
    // Only keep first 500 lines to stay fast
    const trimmed = content.split("\n").slice(0, 500).join("\n");
    _specCache.set(key, trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

// Extract string and number literals from code text
function extractLiterals(text) {
  if (!text) return { strings: [], numbers: [] };
  const strings = [];
  const numbers = [];
  // String literals (single, double, backtick — simple extraction)
  const strRe = /['"]([^'"]{2,80})['"]/g;
  let m;
  while ((m = strRe.exec(text)) !== null) strings.push(m[1]);
  // Number literals (skip 0, 1, common indices)
  const numRe = /\b(\d{2,}(?:\.\d+)?)\b/g;
  while ((m = numRe.exec(text)) !== null) numbers.push(m[1]);
  return { strings, numbers };
}

// Behavioral keywords for medium-confidence matching
const BEHAVIORAL_KEYWORDS = [
  "validate",
  "check",
  "verify",
  "require",
  "reject",
  "deny",
  "block",
  "prevent",
  "disallow",
  "accept",
  "allow",
  "permit",
  "enable",
  "support",
  "max",
  "min",
  "limit",
  "threshold",
  "cap",
  "format",
  "type",
  "extension",
  "mime",
  "redirect",
  "navigate",
  "route",
  "timeout",
  "retry",
  "delay",
];

function stageRequirementDrift(rel, codeFeature, oldStr, newStr, how, why) {
  if (!codeFeature) return; // Can't map to a spec without a feature

  const startTime = Date.now();
  const TIMEOUT_MS = 3000;

  // Find spec files for this feature
  const featureDir = path.join(FEATURES_DIR, codeFeature);
  if (!fs.existsSync(featureDir)) return;

  const specFiles = SPEC_FILE_NAMES.map((name) => ({
    name,
    path: path.join(featureDir, name),
    rel: `requirements/05-features/${codeFeature}/${name}`,
  })).filter((s) => fs.existsSync(s.path));

  if (specFiles.length === 0) return;

  // Extract literals from old and new code
  const oldLiterals = extractLiterals(oldStr);
  const newLiterals = extractLiterals(newStr);

  // Values that changed: in old but not in new
  const removedStrings = oldLiterals.strings.filter(
    (s) => !newLiterals.strings.includes(s),
  );
  const removedNumbers = oldLiterals.numbers.filter(
    (n) => !newLiterals.numbers.includes(n),
  );
  const addedStrings = newLiterals.strings.filter(
    (s) => !oldLiterals.strings.includes(s),
  );

  // Scan each spec file for drift
  for (const spec of specFiles) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      // Timeout — log partial entry
      centralLog(
        "requirement_staged",
        {
          file: rel,
          feature: codeFeature,
          edit_how: how,
          edit_why: why,
          spec_file: spec.rel,
          drift_type: "unknown",
          suggested_update: "Timeout during spec scan — manual review needed",
          confidence: "timeout",
          status: "pending",
        },
        { id: nextEventId(), actor: "system" },
      );
      return;
    }

    const content = readSpecCached(spec.path);
    if (!content) continue;

    // Strategy A: Value Match (high confidence)
    for (const oldVal of [...removedStrings, ...removedNumbers]) {
      if (content.includes(oldVal)) {
        // Find the line containing the match for excerpt
        const lines = content.split("\n");
        const matchLine = lines.find((l) => l.includes(oldVal)) || "";
        const newVal = addedStrings[0] || "(changed)";

        centralLog(
          "requirement_staged",
          {
            file: rel,
            feature: codeFeature,
            edit_how: how,
            edit_why: why,
            spec_file: spec.rel,
            requirement_id: extractStoryId(matchLine),
            spec_excerpt: truncate(matchLine.trim(), 200),
            drift_type: "overwrite",
            suggested_update: `Value "${oldVal}" changed to "${newVal}" in code — update spec to match`,
            confidence: "high",
            status: "pending",
            group: getGroupId(codeFeature),
          },
          { id: nextEventId(), actor: "system" },
        );
        return; // One entry per edit is enough
      }
    }

    // Strategy B: Behavioral Keyword Match (medium confidence)
    const diffText = (newStr || "") + " " + (oldStr || "");
    const matchedKeywords = BEHAVIORAL_KEYWORDS.filter((kw) =>
      diffText.toLowerCase().includes(kw),
    );

    if (matchedKeywords.length > 0) {
      // Check if spec mentions any of these keywords
      const contentLower = content.toLowerCase();
      const specKeywords = matchedKeywords.filter((kw) =>
        contentLower.includes(kw),
      );

      if (specKeywords.length > 0) {
        // Determine drift type
        let driftType = "extension";
        if (!newStr || newStr.trim() === "") driftType = "removal";
        else if (!oldStr || oldStr.trim() === "") driftType = "new_behavior";
        else driftType = "extension";

        centralLog(
          "requirement_staged",
          {
            file: rel,
            feature: codeFeature,
            edit_how: how,
            edit_why: why,
            spec_file: spec.rel,
            requirement_id: null,
            spec_excerpt: null,
            drift_type: driftType,
            suggested_update: `Code change touches behavior keywords [${specKeywords.join(", ")}] — review spec for accuracy`,
            confidence: "medium",
            status: "pending",
            group: getGroupId(codeFeature),
          },
          { id: nextEventId(), actor: "system" },
        );
        return;
      }
    }
  }

  // Strategy C: Component-Story Mapping (low confidence) — only if nothing else matched
  // Any code edit to a feature-mapped component gets a low-confidence entry
  centralLog(
    "requirement_staged",
    {
      file: rel,
      feature: codeFeature,
      edit_how: how,
      edit_why: why,
      spec_file: specFiles[0]?.rel || null,
      requirement_id: null,
      spec_excerpt: null,
      drift_type: "extension",
      suggested_update: `Component edited — verify spec still matches behavior`,
      confidence: "low",
      status: "pending",
      group: getGroupId(codeFeature),
    },
    { id: nextEventId(), actor: "system" },
  );
}

// Extract story ID (GS-XXX-NN) from a spec line
function extractStoryId(line) {
  const m = (line || "").match(/\b(GS-[A-Z]+-\d+)\b/);
  return m ? m[1] : null;
}

// Phase 3C — emit a structured RCO with riskClass, impactedRequirements,
// downstream features, recommended updates. Engine lives in
// `scripts/requirements/`. Lazy-required so the hook still works on installs
// where the engine hasn't shipped yet.
function stageStructuredRCO(rel, codeFeature, oldStr, newStr, how, why) {
  let stageRCO, markStale;
  try {
    ({ stageRCO } = require("../requirements/stage-rco"));
    ({ markStale } = require("../requirements/status"));
  } catch {
    return; // engine not available — skip silently
  }
  const summary = `${how || "edit"} → ${rel}`.slice(0, 200);
  const diffSummary = [
    oldStr && newStr ? "edit" : oldStr ? "remove" : "add",
    rel.match(/\.tsx?$/) ? "code" : rel.match(/\.md$/) ? "spec" : "other",
    /\bauth|token|cookie|jwt|oauth|password|session\b/i.test(why || rel)
      ? "auth-touch"
      : "",
    /\brocket|payment|stripe|charge|tier\b/i.test(why || rel)
      ? "payment-touch"
      : "",
  ]
    .filter(Boolean)
    .join("/");

  // Cap diff text at 32KB so we forward enough signal to the classifier
  // without writing huge pastes to the JSONL log. classify-drift is the
  // primary consumer; gate.js doesn't read these fields.
  const cap = (s) => (typeof s === "string" ? s.slice(0, 32 * 1024) : "");
  const rco = stageRCO({
    trigger: "edit_watcher",
    sourceFile: rel,
    changedFiles: [rel.replace(/\\/g, "/")],
    summary,
    diffSummary,
    reason: why || how || "edit",
    agentSummary: codeFeature ? `feature=${codeFeature}` : "",
    oldString: cap(oldStr),
    newString: cap(newStr),
  });

  if (rco && rco.impactedRequirements && rco.impactedRequirements.length > 0) {
    try {
      markStale(rco.impactedRequirements, rco.id);
    } catch {
      /* non-critical */
    }
  }
}

// ── Feature/Direction Detection ──────────────────────────

function extractFeature(rel) {
  const m = rel.match(/^requirements\/05-features\/([^/]+)\//);
  return m ? m[1] : null;
}

function detectDirection(rel, precedence) {
  if (!precedence?.cascade) return "unknown";
  for (const level of precedence.cascade) {
    const pat = level.pattern.replace(/\*/g, ".*").replace(/\{[^}]+\}/g, ".*");
    if (new RegExp("^" + pat + "$").test(rel)) {
      return level.level <= 6 ? "upstream" : "downstream";
    }
  }
  return "unknown";
}

// ── STALE Marker Management ──────────────────────────────

const STALE_PATTERN = /^<!-- STALE: .+ -->\n?/gm;

// Check if an edit only added/removed STALE markers (no semantic change)
function isStaleOnlyChange(oldStr, newStr) {
  if (!oldStr && !newStr) return true;
  const stripStale = (s) => (s || "").replace(STALE_PATTERN, "").trim();
  return stripStale(oldStr) === stripStale(newStr);
}

function addStaleMarker(consumerPath, sourcePath, ts) {
  const abs = path.join(PROJECT, consumerPath);
  if (!fs.existsSync(abs)) return false;

  let content = fs.readFileSync(abs, "utf8");
  const marker = `<!-- STALE: ${sourcePath} changed at ${ts} — review needed -->`;

  // Don't duplicate same-source marker
  if (content.includes(`STALE: ${sourcePath}`)) return false;

  content = marker + "\n" + content;
  fs.writeFileSync(abs, content, "utf8");
  return true;
}

// ── SPEC_GRAPH Consumer Resolution ──────────────────────

function resolveConsumers(rel, graph) {
  const consumers = [];
  const feature = extractFeature(rel);

  // Check pattern edges
  if (graph?.edges?.patterns) {
    for (const edge of graph.edges.patterns) {
      const fromPat = edge.from.replace(/\*/g, "[^/]+");
      if (new RegExp("^" + fromPat + "$").test(rel)) {
        for (const to of edge.to) {
          if (edge.scope === "same-feature" && feature) {
            consumers.push(`requirements/05-features/${feature}/${to}`);
          } else {
            consumers.push(to);
          }
        }
      }
    }
  }

  // Check explicit edges
  if (graph?.edges?.explicit) {
    for (const edge of graph.edges.explicit) {
      const fromPat = edge.from
        .replace(/\*/g, "[^/]+")
        .replace(/\{[^}]+\}/g, "[^/]+");
      if (new RegExp("^" + fromPat + "$").test(rel)) {
        for (const to of edge.to) {
          if (to.includes("*") && feature) {
            // Expand wildcard for same feature
            consumers.push(to.replace("*", feature));
          } else if (to.includes("*")) {
            // Expand wildcard for all features
            const scanDir = FEATURES_DIR;
            try {
              const features = fs
                .readdirSync(scanDir, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
              for (const f of features) {
                consumers.push(to.replace("*", f));
              }
            } catch {
              /* scan failed, skip */
            }
          } else {
            consumers.push(to);
          }
        }
      }
    }
  }

  return [...new Set(consumers)];
}

// ── New File Type Detection ──────────────────────────────

function checkNewFileType(rel, graph) {
  const feature = extractFeature(rel);
  if (!feature) return null;

  const basename = path.basename(rel);
  const known = graph?.file_types?.known || [];
  const discovered = graph?.file_types?.discovered || [];

  if (!known.includes(basename) && !discovered.includes(basename)) {
    return basename;
  }
  return null;
}

function registerDiscoveredType(basename, graph) {
  if (!graph.file_types) graph.file_types = { known: [], discovered: [] };
  if (!graph.file_types.discovered.includes(basename)) {
    graph.file_types.discovered.push(basename);
    writeJSON(SPEC_GRAPH_FILE, graph);
  }
}

// ── Event Logging ────────────────────────────────────────

function logSpecEvent(evt) {
  // Centralized log (primary)
  const data = {
    file: evt.file,
    change: evt.change,
    direction: evt.direction,
    group: evt.group,
    trigger: evt.trigger,
    source: evt.source,
    stale_consumers: evt.stale_consumers,
    propagated: evt.propagated,
  };
  // Include enhanced fields if present
  if (evt.layer) data.layer = evt.layer;
  if (evt.feature) data.feature = evt.feature;
  if (evt.how) data.how = evt.how;
  if (evt.why) data.why = evt.why;
  if (evt.propagation_status) data.propagation_status = evt.propagation_status;

  centralLog("spec", data, { id: evt.id, actor: "system" });
}

// ── Main ─────────────────────────────────────────────────

try {
  if (process.stdin.isTTY) process.exit(0);

  const chunks = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    let event;
    try {
      event = JSON.parse(chunks.join(""));
    } catch {
      process.exit(0);
    }

    const toolName = event?.tool_name || "";
    const toolInput = event?.tool_input || {};
    const filePath = toolInput.file_path || "";
    if (!filePath) process.exit(0);

    const rel = relPath(filePath);
    const isSpec = isSpecFile(rel);
    const isCode = isCodeFile(rel);

    // Fix-forward (codex Phase 3 review 2026-04-30): SPEC/CODE patterns
    // exclude `src/lib/`, `services/backend/`, `packages/shared/`, and other
    // mapped-but-unpatterned paths. Before bailing, check whether the file is
    // in the requirements graph's file index — if so, fire only the
    // structured-RCO path and exit. This closes the gap where high-risk
    // mapped code (auth, storage, contracts) silently exits without filing
    // a Class C RCO.
    if (!isSpec && !isCode) {
      try {
        const { findByImplementedFile } = require("../requirements/graph-load");
        const norm = rel.replace(/\\/g, "/");
        const hit = findByImplementedFile(norm);
        if (hit && (hit.requirements.length > 0 || hit.features.length > 0)) {
          const oldStr = toolInput.old_string || "";
          const newStr = toolInput.new_string || toolInput.content || "";
          const codeFeature = hit.features[0] || null;
          stageStructuredRCO(rel, codeFeature, oldStr, newStr, "edit", "");
        }
      } catch {
        /* graph engine optional */
      }
      process.exit(0);
    }

    // Load system files (only needed for spec events)
    const graph = isSpec ? readJSON(SPEC_GRAPH_FILE) : null;
    const precedence = isSpec ? readJSON(PRECEDENCE_FILE) : null;

    // Extract change info
    const oldStr = toolInput.old_string || "";
    const newStr = toolInput.new_string || toolInput.content || "";
    let changeSummary = "";
    if (toolName === "Edit") {
      const old = truncate(oldStr, 50);
      const nu = truncate(newStr, 50);
      changeSummary = `${old} → ${nu}`;
    } else if (toolName === "Write") {
      changeSummary = "File created/rewritten";
    }

    const feature = extractFeature(rel);
    const direction = isSpec ? detectDirection(rel, precedence) : "unknown";
    const ts = isoNow();
    const how = buildHow(toolName, oldStr, newStr);
    const why = findRecentWhy();

    // ── Code file tracking ──
    if (isCode && !isSpec) {
      const component = extractComponent(rel);
      const step = extractStep(component);
      const codeFeature =
        (component && COMPONENT_FEATURE_MAP[component]) || feature || null;
      const scope = detectScope(toolName, oldStr, newStr);

      centralLog(
        "code",
        {
          file: rel,
          change: truncate(changeSummary, 120),
          how,
          why,
          component,
          step,
          feature: codeFeature,
          scope,
        },
        { id: nextEventId(), actor: "system" },
      );

      // Stage requirement drift entry (best-effort, never blocks)
      try {
        stageRequirementDrift(rel, codeFeature, oldStr, newStr, how, why);
      } catch {
        /* non-critical */
      }

      // Phase 3C: also emit a structured RCO (riskClass + impactedRequirements
      // + recommendedSpecUpdate) and mark linked requirements stale_pending_review.
      // Best-effort, never blocks. Codex Phase 3 review fix-forward
      // (2026-04-30): no longer silent — log the error to stderr + the central
      // log so corrupt-graph or write-failure conditions don't hide critical
      // drift behind a swallowed catch.
      try {
        stageStructuredRCO(rel, codeFeature, oldStr, newStr, how, why);
      } catch (rcoErr) {
        process.stderr.write(
          `[edit-watcher] structured-RCO staging failed for ${rel}: ${rcoErr.message}\n`,
        );
        try {
          centralLog(
            "rco_stage_error",
            {
              file: rel,
              feature: codeFeature || null,
              error: String(rcoErr.message || rcoErr).slice(0, 500),
            },
            { id: nextEventId(), actor: "system" },
          );
        } catch {
          /* logger itself broken — give up */
        }
      }

      process.exit(0);
    }

    // ── Spec file tracking (existing + enhanced) ──

    // Step 0: New file type detection
    if (graph) {
      const newType = checkNewFileType(rel, graph);
      if (newType) {
        registerDiscoveredType(newType, graph);
        const msg = `New spec file type detected: ${newType}`;
        process.stderr.write(`[pulse] ⚡ ${msg}\n`);
        logSpecEvent({
          id: nextEventId(),
          ts,
          file: rel,
          change: msg,
          direction: "topology",
          group: "TOPO",
          trigger: "discovery",
          source: "edit-watcher",
          propagated: false,
        });
      }
    }

    // Step 1: Log structured event (enhanced with layer/feature/how/why)
    const layer = detectLayer(rel);
    const groupId = getGroupId(feature || rel);
    const evt = {
      id: nextEventId(),
      ts,
      session_id: getSessionId(),
      file: rel,
      change: truncate(changeSummary, 120),
      layer,
      feature: feature || null,
      how,
      why,
      direction,
      group: groupId,
      trigger: "edit",
      source: toolName,
      stale_consumers: [],
      propagation_status: "pending",
      propagated: false,
    };

    // ── Step 2: Mark consumers stale ──
    // Skip STALE propagation for fixtures — holdout isolation
    if (layer === "fixture") {
      process.stderr.write(
        `[pulse] Fixture edit logged (no STALE markers — holdout isolation)\n`,
      );
    } else if (isStaleOnlyChange(oldStr, newStr)) {
      // Edit only added/removed STALE markers — no semantic change, skip cascade
      process.stderr.write(
        `[pulse] STALE-only change detected — skipping cascade\n`,
      );
      evt.propagation_status = "skipped-stale-only";
    } else if (graph) {
      const consumers = resolveConsumers(rel, graph);
      const marked = [];
      for (const consumer of consumers) {
        if (consumer === rel) continue; // don't mark self
        if (addStaleMarker(consumer, rel, ts)) {
          marked.push(consumer);
        }
      }
      evt.stale_consumers = marked;
      if (marked.length > 0) {
        process.stderr.write(
          `[pulse] 📋 Marked ${marked.length} file(s) STALE: ${marked.join(", ")}\n`,
        );
      }
    }

    logSpecEvent(evt);

    // ── Step 3: Field registry drift check (lightweight) ──
    // Only check for value files, not every edit
    const registry = readJSON(FIELD_REGISTRY_FILE);
    if (registry && toolName === "Edit" && toolInput.new_string) {
      // Quick check: does the new content contain any registry numeric values?
      // This is intentionally lightweight — deep drift checks happen in /reconcile
      const newStr = toolInput.new_string;
      const oldStr = toolInput.old_string || "";

      // Check if a known numeric value was changed
      for (const [section, entries] of Object.entries(registry)) {
        if (typeof entries !== "object") continue;
        for (const [key, def] of Object.entries(entries)) {
          if (def?.value !== undefined && typeof def.value === "number") {
            const val = String(def.value);
            // If old text had the registry value but new text doesn't, flag it
            if (oldStr.includes(val) && !newStr.includes(val)) {
              process.stderr.write(
                `[pulse] ⚠️  Possible registry drift: ${section}.${key}=${val} was in old text but not new. Check FIELD_REGISTRY.json\n`,
              );
            }
          }
        }
      }
    }

    process.exit(0);
  });
} catch {
  process.exit(0);
}
