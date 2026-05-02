/**
 * graph-build.js — Parse the requirements/ tree into a single machine-readable graph.
 *
 * Output: requirements/_index/requirements.graph.json
 *         requirements/05-features/<feature>/TRACE.md (per-feature, human-readable)
 *
 * Phase 3A + 3K artifact. Read from /check:requirements and edit-watcher.
 *
 * Usage:
 *   node scripts/requirements/build-graph.js          # write graph + traces
 *   node scripts/requirements/build-graph.js --check  # exit 1 if graph is stale
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const {
  SPECS_ROOT,
  INDEX_DIR,
  CONTRACTS_DIR,
  GRAPH_FILE,
  ID_PATTERNS,
  VERIFICATION_STATUS,
  LIFECYCLE_STATUS,
  listFeatureDirs,
} = require("./config");

const GRAPH_VERSION = 1;

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function gitHeadSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function gitLastTouched(filePath) {
  try {
    const out = execSync(
      `git log -1 --format=%H -- "${filePath.replace(/\\/g, "/")}"`,
      { encoding: "utf8" },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Extract file references from a PRD's Section 13 (Implementation Map).
 * Section 13 is a markdown table; file paths appear in the first column inside backticks.
 * Annotations like `(new)`, `(migrated)`, `(legacy)` are stripped.
 */
function extractImplementationMapFiles(prdContent) {
  if (!prdContent) return [];
  // Find Section 13 by header (handle `## 13.` and `### 13.`)
  const sectionMatch = prdContent.match(
    /^#{2,3}\s*13\.\s*Implementation Map[\s\S]*?(?=^#{2,3}\s*1[4-9]\.|\Z)/m,
  );
  if (!sectionMatch) return [];
  const section = sectionMatch[0];
  const files = new Set();
  // Match backtick-quoted tokens that look like file paths
  const tokenRegex = /`([^`]+)`/g;
  let m;
  while ((m = tokenRegex.exec(section)) !== null) {
    let token = m[1].trim();
    // Strip parenthetical annotations: "src/foo.ts (new)" or "(new)"
    token = token.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!token) continue;
    // Heuristic: looks like a file path — has / or . extension we recognize
    if (
      /[/\\]/.test(token) ||
      /\.(ts|tsx|js|jsx|json|md|css|scss|sql|sh|py|env|toml|yaml|yml)$/i.test(
        token,
      )
    ) {
      // Drop trailing wildcards like /api/auth/*
      const cleaned = token.replace(/\/\*+$/, "");
      files.add(cleaned);
    }
  }
  return Array.from(files).sort();
}

/**
 * Parse STORIES.md for granular-story blocks.
 * Each block:
 *   ### GS-XXX-NN: Title
 *   metadata lines (Depends on, Data, Entry state, Verifiable by, Inherits)
 *   blank line
 *   **Acceptance Criteria:** then bullets
 */
function parseStories(storiesContent, opts) {
  if (!storiesContent) return [];
  const { feature } = opts;
  const stories = [];
  // Split on `### GS-XXX-NN:` headings
  const blocks = storiesContent.split(
    /^### (GS-[A-Z][A-Z0-9]{1,12}-\d{2,3}):/m,
  );
  for (let i = 1; i < blocks.length; i += 2) {
    const id = blocks[i].trim();
    const body = blocks[i + 1] || "";
    const titleMatch = body.match(/^\s*([^\n]+)/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const dependsOn = parseDependsOn(body);
    const dataFiles = extractDataFiles(body);
    const inherits = parseInheritsList(body);
    const parents = parseParentHeading(storiesContent, id);
    // Acceptance criteria — list of bullets after **Acceptance Criteria:**
    const criteria = parseAcceptanceCriteria(body);
    stories.push({
      id,
      type: "granular_story",
      feature,
      title,
      dependsOn,
      implementedBy: dataFiles,
      verifiedBy: [], // populated later if tests exist
      acceptanceCriteria: criteria,
      inherits,
      parents,
      verificationStatus: VERIFICATION_STATUS.UNVERIFIED_ALLOWED_TEMPORARILY,
      status: LIFECYCLE_STATUS.ACTIVE,
    });
  }
  return stories;
}

function parseHLStories(hlContent, opts) {
  if (!hlContent) return [];
  const { feature } = opts;
  const stories = [];
  const blocks = hlContent.split(/^## (HL-[A-Z][A-Z0-9]{1,12}-\d{2,3}):/m);
  for (let i = 1; i < blocks.length; i += 2) {
    const id = blocks[i].trim();
    const body = blocks[i + 1] || "";
    const titleMatch = body.match(/^\s*([^\n]+)/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const classification = (body.match(
      /\*\*Classification:\*\*\s*([^\n]+)/,
    ) || [, ""])[1].trim();
    const criteria = parseAcceptanceCriteria(body);
    stories.push({
      id,
      type: "high_level_story",
      feature,
      title,
      classification,
      acceptanceCriteria: criteria,
      verificationStatus: VERIFICATION_STATUS.UNVERIFIED_ALLOWED_TEMPORARILY,
      status: LIFECYCLE_STATUS.ACTIVE,
    });
  }
  return stories;
}

function parseDependsOn(body) {
  const m = body.match(/\*\*Depends on:\*\*\s*([^\n]+)/);
  if (!m) return [];
  const raw = m[1].trim();
  if (raw.toLowerCase() === "none") return [];
  return Array.from(
    raw.matchAll(/\b(?:GS|HL)-[A-Z][A-Z0-9]{1,12}-\d{2,3}\b/g),
  ).map((x) => x[0]);
}

function parseInheritsList(body) {
  const m = body.match(/\*\*Inherits:\*\*\s*([^\n]+)/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/\bCS-\d{3}\b/g)).map((x) => x[0]);
}

function extractDataFiles(body) {
  const m = body.match(/\*\*Data:\*\*\s*([^\n]+)/);
  if (!m) return [];
  const files = new Set();
  // Match backtick file paths
  for (const match of m[1].matchAll(/`([^`]+)`/g)) {
    const t = match[1].trim();
    if (/[/\\]/.test(t) || /\.(ts|tsx|js|jsx|json|md)$/i.test(t)) {
      files.add(t);
    }
  }
  return Array.from(files).sort();
}

function parseParentHeading(storiesContent, gsId) {
  // Find the most recent `## Parent: HL-XXX-NN` heading before the GS block
  const idx = storiesContent.indexOf(`### ${gsId}:`);
  if (idx === -1) return [];
  const prelude = storiesContent.slice(0, idx);
  const matches = Array.from(
    prelude.matchAll(/^## Parent:\s*(HL-[A-Z][A-Z0-9]{1,12}-\d{2,3})/gm),
  );
  if (!matches.length) return [];
  return [matches[matches.length - 1][1]];
}

function parseAcceptanceCriteria(body) {
  const m = body.match(
    /\*\*Acceptance Criteria:\*\*([\s\S]*?)(?=\n---|\n\*\*[A-Z]|\Z)/,
  );
  if (!m) return [];
  const lines = m[1].split("\n");
  const bullets = [];
  for (const line of lines) {
    const bm = line.match(/^\s*-\s+(.+)$/);
    if (bm) bullets.push(bm[1].trim());
  }
  return bullets;
}

/**
 * Parse PRD frontmatter / first paragraph for status hints.
 * Handles HTML comments at top: <!-- v3 aligned with ... --> or STALE banners.
 */
function parsePRDStatus(prdContent) {
  if (!prdContent) return LIFECYCLE_STATUS.ACTIVE;
  if (/STALE\s*[—:-]/i.test(prdContent.slice(0, 500))) {
    return "stale_banner_present";
  }
  return LIFECYCLE_STATUS.ACTIVE;
}

/**
 * Parse contracts directory (3G).
 * Each contract is a single markdown file with a frontmatter-ish header.
 */
function parseContracts() {
  if (!fs.existsSync(CONTRACTS_DIR)) return {};
  const out = {};
  for (const ent of fs.readdirSync(CONTRACTS_DIR, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const id = ent.name.replace(/\.md$/, "");
    const file = path.join(CONTRACTS_DIR, ent.name);
    const content = safeRead(file) || "";
    const owner = (content.match(/^-\s*\*\*Owner:\*\*\s*([^\n]+)/m) || [
      ,
      "",
    ])[1].trim();
    const usedBy = Array.from(
      content.matchAll(/^-\s*\*\*Used by:\*\*\s*([^\n]+)/gm),
    ).flatMap((m) =>
      m[1]
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    out[id] = {
      id,
      file: path
        .relative(path.resolve(__dirname, "..", ".."), file)
        .replace(/\\/g, "/"),
      owner,
      usedBy,
    };
  }
  return out;
}

function relPath(absFile) {
  return path
    .relative(path.resolve(__dirname, "..", ".."), absFile)
    .replace(/\\/g, "/");
}

function buildGraph() {
  const features = {};
  const requirements = {};
  const filesIndex = {};
  const headSha = gitHeadSha();

  for (const featureDir of listFeatureDirs()) {
    const dir = path.join(SPECS_ROOT, featureDir);
    const prdPath = path.join(dir, "PRD.md");
    const storiesPath = path.join(dir, "STORIES.md");
    const hlPath = path.join(dir, "HL-STORIES.md");
    const inputsPath = path.join(dir, "INPUTS.md");
    const copyPath = path.join(dir, "COPY.md");

    const prd = safeRead(prdPath);
    const stories = safeRead(storiesPath);
    const hlStories = safeRead(hlPath);

    if (!prd && !stories && !hlStories) continue; // empty feature

    const implementedFiles = extractImplementationMapFiles(prd || "");
    const featureRecord = {
      name: featureDir,
      title: extractTitle(prd) || featureDir,
      specDir: relPath(dir),
      hasPRD: !!prd,
      hasStories: !!stories,
      hasHLStories: !!hlStories,
      hasInputs: !!safeRead(inputsPath),
      hasCopy: !!safeRead(copyPath),
      prdSha: prd ? sha256(prd) : null,
      storiesSha: stories ? sha256(stories) : null,
      hlStoriesSha: hlStories ? sha256(hlStories) : null,
      implementedBy: implementedFiles,
      verifiedBy: [], // tests/<feature>/ — no tests/ dir yet (2026-04-30)
      dependsOn: [], // populated below from per-story dependencies
      usedBy: [],
      sharedContractsTouched: extractContractRefs(prd || ""),
      status: parsePRDStatus(prd || ""),
      lastChangedCommit: gitLastTouched(prdPath),
      lastVerifiedCommit: null,
    };
    features[featureDir] = featureRecord;

    // Index files → feature
    for (const f of implementedFiles) {
      if (!filesIndex[f])
        filesIndex[f] = { implements: [], features: new Set() };
      filesIndex[f].features.add(featureDir);
    }

    // Granular stories
    for (const story of parseStories(stories, { feature: featureDir })) {
      requirements[story.id] = {
        ...story,
        specFile: relPath(storiesPath),
        lastChangedCommit: gitLastTouched(storiesPath),
        lastVerifiedCommit: null,
      };
      // Aggregate file → requirement reverse index
      for (const f of story.implementedBy) {
        if (!filesIndex[f])
          filesIndex[f] = { implements: [], features: new Set() };
        filesIndex[f].implements.push(story.id);
        filesIndex[f].features.add(featureDir);
      }
      // Cross-feature dependency aggregation deferred to a second pass —
      // inferFeatureFromId can't resolve a prefix (ATH → auth) until all
      // features have written their stories. Codex Phase 3 review caught
      // this: usedBy was always empty, so downstream impact resolution
      // produced empty `downstreamFeatures` for every RCO.
    }

    // High-level stories
    for (const hl of parseHLStories(hlStories, { feature: featureDir })) {
      requirements[hl.id] = {
        ...hl,
        specFile: relPath(hlPath),
        lastChangedCommit: gitLastTouched(hlPath),
        lastVerifiedCommit: null,
      };
    }
  }

  // Second pass: resolve cross-feature dependencies via the requirements map.
  // Walk every story's dependsOn list; look up the dep ID in `requirements`
  // to find its owning feature. Aggregate at the feature level.
  for (const story of Object.values(requirements)) {
    if (story.type !== "granular_story") continue;
    if (!Array.isArray(story.dependsOn) || story.dependsOn.length === 0)
      continue;
    const owner = features[story.feature];
    if (!owner) continue;
    for (const depId of story.dependsOn) {
      const depReq = requirements[depId];
      if (!depReq || !depReq.feature) continue;
      if (depReq.feature === story.feature) continue;
      if (!owner.dependsOn.includes(depReq.feature)) {
        owner.dependsOn.push(depReq.feature);
      }
    }
  }

  // Resolve usedBy from dependsOn (reverse map)
  for (const [feat, rec] of Object.entries(features)) {
    for (const dep of rec.dependsOn) {
      if (features[dep]) {
        if (!features[dep].usedBy.includes(feat))
          features[dep].usedBy.push(feat);
      }
    }
  }

  // Convert filesIndex Sets → sorted arrays
  const filesOut = {};
  for (const [file, idx] of Object.entries(filesIndex)) {
    filesOut[file] = {
      implements: Array.from(new Set(idx.implements)).sort(),
      features: Array.from(idx.features).sort(),
    };
  }

  return {
    version: GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    generatedFromCommit: headSha,
    schemaUrl: "warpos/requirements-graph/v1",
    counts: {
      features: Object.keys(features).length,
      requirements: Object.keys(requirements).length,
      mappedFiles: Object.keys(filesOut).length,
    },
    features,
    requirements,
    files: filesOut,
    contracts: parseContracts(),
  };
}

function extractTitle(prd) {
  if (!prd) return null;
  const m = prd.match(/^#\s+PRD:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractContractRefs(prd) {
  if (!prd) return [];
  const ids = new Set();
  // Match upper-case contract names from a known seed list. Loose match — any
  // explicit reference to "SESSION contract" or `contracts/USER` etc.
  const seed = [
    "SESSION",
    "USER",
    "WORKSPACE",
    "PAYMENT",
    "ROUTING",
    "PERMISSIONS",
  ];
  for (const c of seed) {
    const re = new RegExp(`(contracts?/${c}|${c}\\s+contract)`, "i");
    if (re.test(prd)) ids.add(c);
  }
  return Array.from(ids).sort();
}

function inferFeatureFromId(id) {
  // GS-ATH-01 → ATH; lookup which feature uses ATH prefix.
  // For now, use a trivial heuristic — whatever feature already declared this story.
  const m = id.match(/^(?:GS|HL)-([A-Z][A-Z0-9]{1,12})-\d{2,3}$/);
  if (!m) return null;
  return null; // computed by caller via reverse lookup if needed
}

function writeTraceMarkdown(graph, featureDir) {
  const dir = path.join(SPECS_ROOT, featureDir);
  if (!fs.existsSync(dir)) return;
  const f = graph.features[featureDir];
  if (!f) return;

  const reqsForFeature = Object.values(graph.requirements).filter(
    (r) => r.feature === featureDir,
  );
  const granular = reqsForFeature.filter((r) => r.type === "granular_story");
  const hl = reqsForFeature.filter((r) => r.type === "high_level_story");

  let md = `<!-- generated by scripts/requirements/graph-build.js — do not edit -->\n`;
  md += `# Requirements Trace: ${f.title}\n\n`;
  md += `> Generated ${graph.generatedAt} from ${graph.generatedFromCommit || "(no git)"}.\n\n`;
  md += `## Coverage\n\n`;
  md += `- High-level stories: **${hl.length}**\n`;
  md += `- Granular stories: **${granular.length}**\n`;
  md += `- Files in implementation map: **${f.implementedBy.length}**\n`;
  md += `- Cross-feature dependencies: **${f.dependsOn.length}**\n`;
  md += `- Used by: **${f.usedBy.length}**\n`;
  md += `- Shared contracts touched: ${f.sharedContractsTouched.length ? f.sharedContractsTouched.join(", ") : "none"}\n\n`;
  md += `## High-level stories\n\n`;
  for (const r of hl) {
    md += `- **${r.id}** — ${r.title}${r.classification ? ` _(${r.classification})_` : ""}\n`;
  }
  md += `\n## Granular stories\n\n`;
  for (const r of granular) {
    const parents =
      r.parents && r.parents.length ? ` ← ${r.parents.join(", ")}` : "";
    const files =
      r.implementedBy && r.implementedBy.length
        ? ` · files: ${r.implementedBy.map((x) => `\`${x}\``).join(", ")}`
        : "";
    md += `- **${r.id}** — ${r.title}${parents}${files}\n`;
  }
  md += `\n## Implementation map (Section 13)\n\n`;
  for (const file of f.implementedBy) {
    md += `- \`${file}\`\n`;
  }
  if (!f.implementedBy.length)
    md += `_(no Section 13 implementation map detected)_\n`;
  md += `\n## Cross-feature edges\n\n`;
  md += `- depends on: ${f.dependsOn.length ? f.dependsOn.join(", ") : "none"}\n`;
  md += `- used by: ${f.usedBy.length ? f.usedBy.join(", ") : "none"}\n`;

  fs.writeFileSync(path.join(dir, "TRACE.md"), md);
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");

  if (!fs.existsSync(INDEX_DIR)) fs.mkdirSync(INDEX_DIR, { recursive: true });

  const graph = buildGraph();
  const newJson = JSON.stringify(graph, null, 2) + "\n";

  if (checkMode) {
    const existing = safeRead(GRAPH_FILE) || "";
    // Strip generatedAt + generatedFromCommit for stable comparison
    const stripVolatile = (s) =>
      s
        .replace(/"generatedAt":\s*"[^"]+",\n/, "")
        .replace(/"generatedFromCommit":\s*("[^"]*"|null),\n/, "");
    if (stripVolatile(existing) !== stripVolatile(newJson)) {
      console.error(
        "Requirements graph is stale — run: node scripts/requirements/graph-build.js",
      );
      process.exit(1);
    }
    console.log("Requirements graph is current.");
    return;
  }

  fs.writeFileSync(GRAPH_FILE, newJson);
  console.log(
    `Wrote ${path.relative(process.cwd(), GRAPH_FILE)} (${graph.counts.requirements} requirements, ${graph.counts.features} features, ${graph.counts.mappedFiles} files)`,
  );

  for (const f of Object.keys(graph.features)) {
    writeTraceMarkdown(graph, f);
  }
}

if (require.main === module) main();

module.exports = {
  buildGraph,
  parseStories,
  parseHLStories,
  parseAcceptanceCriteria,
  parseDependsOn,
  extractImplementationMapFiles,
  extractContractRefs,
};
