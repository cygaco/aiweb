#!/usr/bin/env node

/**
 * Granular Stories Linter — Automated validation for Jobzooka granular stories.
 *
 * Checks:
 *   1. FORMAT      — Story format, role normalization, single behavior
 *   2. METADATA    — Depends on, Data, Verifiable by present on every story
 *   3. CRITERIA    — 1-4 acceptance criteria, at least one boundary/prevention
 *   4. PARENTS     — Every story maps to an HL story that exists in HL-STORIES.md
 *   5. SHARED      — Inherits references point to valid CS-XXX IDs
 *   6. DEPS        — Dependency graph is acyclic, referenced IDs exist
 *   7. UI LANGUAGE — Warns on platform-specific terms (click, button, modal, etc.)
 *
 * Usage:
 *   node scripts/lint-stories.js              # lint all
 *   node scripts/lint-stories.js onboarding   # lint one feature
 *   node scripts/lint-stories.js --verbose    # show info-level messages
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./hooks/lib/paths");

// ── Config ───────────────────────────────────────────────────────────────

const ROOT = PROJECT;
const FEATURES_DIR = PATHS.specsRoot || path.join(ROOT, "requirements", "05-features");
const COMMON_PATH = path.join(
  PATHS.requirementsRoot || path.join(ROOT, "requirements"),
  "_standards",
  "STORIES-COMMON.md",
);

const ALLOWED_ROLES = [
  "user",
  "user/client",
  "system",
  "product manager",
  "admin",
  "security admin",
  "administrator",
  "platform owner",
  "developer",
  "operator",
  "team",
  "frontend",
  "backend",
  "worker",
  "middleware",
  "webhook handler",
  "endpoint",
  "dev/operator",
  "admin panel",
  "recovery path",
  "deploy pipeline",
  "container",
  "claude call",
  "log line",
  "rollback path",
  "auth layer",
  "extension",
  "extension startup",
];

const BOUNDARY_PATTERNS =
  /\bnot\b|\bnever\b|\bcannot\b|\brejected\b|\bblocked\b|\bprevented\b|\bdisabled\b|\bdoes not\b|\bdo not\b|\bno partial\b|\bwithout\b|\bmust not\b/i;

// Platform-specific UI terms that should use behavioral language instead.
// Named platform elements (Easy Apply button, Chrome extension popup, chrome.runtime)
// are excluded via allowlist patterns applied per-match.
const UI_TERM_PATTERNS = [
  { re: /\bclick(?:s|ed|ing)?\b/gi, sub: "select/activate/trigger" },
  { re: /\bbutton\b/gi, sub: "action/control", allow: /Easy Apply button/i },
  { re: /\bdropdown\b/gi, sub: "selector/selection list" },
  { re: /\bmodal\b/gi, sub: "dialog" },
  { re: /\bcheckbox(?:es)?\b/gi, sub: "toggle" },
];

// Features whose stories are inherently platform-specific get a pass on some terms
const PLATFORM_FEATURES = ["extension", "deus-mechanicus", "auto-apply"];

// Per-story override: if the story body contains <!-- platform-ok -->,
// platform-specific term warnings are downgraded to info for that story.

// ── Helpers ──────────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function error(feature, storyId, msg) {
  return { level: "error", feature, storyId, msg };
}
function warn(feature, storyId, msg) {
  return { level: "warn", feature, storyId, msg };
}
function info(feature, storyId, msg) {
  return { level: "info", feature, storyId, msg };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRole(role) {
  const normalized = role
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+(?:who|with)\b.*$/, "")
    .trim();

  if (/^\/\S+\s+endpoint$/.test(normalized)) return "endpoint";

  return normalized;
}

function extractStoryIds(value) {
  if (!value) return [];
  return [...new Set(value.match(/GS-[A-Z]+-\d+/g) || [])];
}

function extractStories(content) {
  const stories = [];
  const blocks = content.split(/^### /m).filter((s) => s.match(/^GS-/));

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const headerLine = lines[0].trim();

    const idMatch = headerLine.match(/^(GS-[A-Z]+-\d+):\s*(.+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    const title = idMatch[2];

    // Extract story text (blockquote)
    const quoteLine = lines
      .filter((l) => l.startsWith(">"))
      .map((l) => l.replace(/^>\s*/, ""))
      .join(" ")
      .trim();

    // Extract metadata
    const getText = (label) => {
      const labelPattern = new RegExp(
        `^\\*\\*${escapeRegExp(label)}(?:\\s*\\([^)]*\\))?:\\*\\*`,
      );
      const line = lines.find((l) => labelPattern.test(l));
      return line ? line.replace(labelPattern, "").trim() : null;
    };

    const dependsOn = getText("Depends on");
    const data = getText("Data");
    const verifiableBy = getText("Verifiable by");
    const entryState = getText("Entry state");
    const inherits = getText("Inherits");

    // Extract acceptance criteria
    const criteriaStart = lines.findIndex((l) =>
      /\*\*Acceptance Criteria(?:\s*\([^)]*\))?:\*\*/.test(l),
    );
    const criteria = [];
    if (criteriaStart >= 0) {
      for (let i = criteriaStart + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("- ")) {
          criteria.push(line.replace(/^- /, ""));
        }
      }
    }

    // Find parent HL story
    const fullIdx = content.indexOf("### " + headerLine);
    const preceding = content.slice(0, fullIdx);
    const parentMatch = preceding.match(/## Parent: (HL-[A-Z]+-\d+)/g);
    const parent = parentMatch
      ? parentMatch[parentMatch.length - 1].replace("## Parent: ", "")
      : null;

    stories.push({
      id,
      title,
      quoteLine,
      dependsOn,
      data,
      verifiableBy,
      entryState,
      inherits,
      criteria,
      parent,
      raw: block,
      obsolete: /REMOVED IN TARGET STATE|obsolete in the target state/i.test(
        block,
      ),
    });
  }

  return stories;
}

function extractHLStoryIds(hlContent) {
  const ids = [];
  const matches = hlContent.matchAll(/^## (HL-[A-Z]+-\d+)/gm);
  for (const m of matches) ids.push(m[1]);
  return ids;
}

function extractCommonIds(commonContent) {
  const ids = [];
  const matches = commonContent.matchAll(/^## (CS-\d+)/gm);
  for (const m of matches) ids.push(m[1]);
  return ids;
}

// ── Checks ───────────────────────────────────────────────────────────────

function checkStories(feature, stories, hlIds, commonIds) {
  const issues = [];
  const storyIds = stories.map((s) => s.id);

  if (stories.length === 0) {
    issues.push(error(feature, "-", "No stories found in file"));
    return issues;
  }

  for (const story of stories) {
    const {
      id,
      quoteLine,
      dependsOn,
      data,
      verifiableBy,
      entryState,
      inherits,
      criteria,
      parent,
    } = story;

    if (story.obsolete) {
      issues.push(info(feature, id, "Obsolete target-state story skipped"));
      continue;
    }

    // 1. Story format
    if (!quoteLine) {
      issues.push(error(feature, id, "Missing story text (blockquote)"));
      continue;
    }

    const roleMatch = quoteLine.match(
      /^As\s+(?:(?:an?|the|every)\s+)(.+?),\s+I want\b/i,
    );
    if (!roleMatch) {
      issues.push(
        error(
          feature,
          id,
          'Story doesn\'t follow "As a [role], I want..." format',
        ),
      );
    } else {
      const role = normalizeRole(roleMatch[1]);
      if (!ALLOWED_ROLES.includes(role)) {
        issues.push(error(feature, id, `Disallowed role: "${roleMatch[1]}"`));
      }
    }

    if (!/so that\b/i.test(quoteLine)) {
      issues.push(warn(feature, id, 'Missing "so that" benefit clause'));
    }

    // 2. Agentic metadata
    if (!dependsOn) {
      issues.push(error(feature, id, "Missing **Depends on:** metadata"));
    } else if (dependsOn !== "none") {
      // Validate dependency IDs exist
      const depIds = extractStoryIds(dependsOn);
      for (const cleanDep of depIds) {
        if (!storyIds.includes(cleanDep)) {
          // Check if it's a cross-feature reference (different slug)
          const sameFeature =
            cleanDep.match(/^GS-[A-Z]+-/)?.[0] === id.match(/^GS-[A-Z]+-/)?.[0];
          if (sameFeature) {
            issues.push(
              error(feature, id, `Depends on non-existent story: ${cleanDep}`),
            );
          }
        }
      }
    }

    if (!data) {
      issues.push(error(feature, id, "Missing **Data:** metadata"));
    }

    if (!verifiableBy) {
      issues.push(error(feature, id, "Missing **Verifiable by:** metadata"));
    }

    if (!entryState) {
      issues.push(warn(feature, id, "Missing **Entry state:** metadata"));
    }

    // 3. Shared behavior references
    if (inherits) {
      const csIds = inherits
        .split(/,\s*/)
        .map((c) => c.trim())
        .filter((c) => c.match(/^CS-/));
      for (const csId of csIds) {
        if (!commonIds.includes(csId)) {
          issues.push(
            error(feature, id, `Inherits non-existent shared story: ${csId}`),
          );
        }
      }
    }

    // 4. Parent mapping
    if (!parent) {
      issues.push(error(feature, id, "No parent HL story found"));
    } else if (hlIds.length > 0 && !hlIds.includes(parent)) {
      issues.push(
        error(feature, id, `Parent ${parent} not found in HL-STORIES.md`),
      );
    }

    // 5. Acceptance criteria
    if (criteria.length < 1) {
      issues.push(error(feature, id, "No acceptance criteria"));
    } else if (criteria.length > 5) {
      issues.push(
        warn(
          feature,
          id,
          `${criteria.length} acceptance criteria — consider splitting`,
        ),
      );
    }

    // 6. Boundary/prevention rule
    const allCriteria = criteria.join(" ");
    if (!BOUNDARY_PATTERNS.test(allCriteria)) {
      issues.push(
        warn(
          feature,
          id,
          "May lack prevention/boundary rule in acceptance criteria",
        ),
      );
    }
  }

  // 7. Platform-neutral language check
  for (const story of stories) {
    const { id, quoteLine, criteria, verifiableBy } = story;
    const textToCheck = [quoteLine, verifiableBy, ...criteria]
      .filter(Boolean)
      .join(" ");

    for (const { re, sub, allow } of UI_TERM_PATTERNS) {
      re.lastIndex = 0;
      const match = re.exec(textToCheck);
      if (match) {
        // Skip if the match is part of an allowed phrase
        if (allow) {
          const ctx = textToCheck.slice(
            Math.max(0, match.index - 20),
            match.index + match[0].length + 20,
          );
          if (allow.test(ctx)) continue;
        }
        // Downgrade to info for inherently platform-specific features or stories with <!-- platform-ok -->
        const hasPlatformOk =
          story.raw && /<!--\s*platform-ok\s*-->/.test(story.raw);
        const severity =
          PLATFORM_FEATURES.includes(feature) || hasPlatformOk
            ? "info"
            : "warn";
        const fn = severity === "warn" ? warn : info;
        issues.push(
          fn(
            feature,
            id,
            `Platform-specific term "${match[0]}" — prefer ${sub}`,
          ),
        );
      }
    }
  }

  // 8. Dependency cycle detection
  const depGraph = {};
  for (const story of stories) {
    depGraph[story.id] = [];
    if (story.dependsOn && story.dependsOn !== "none") {
      const deps = extractStoryIds(story.dependsOn).filter((d) =>
        storyIds.includes(d),
      );
      depGraph[story.id] = deps;
    }
  }

  function hasCycle(node, visited, stack) {
    visited.add(node);
    stack.add(node);
    for (const dep of depGraph[node] || []) {
      if (!visited.has(dep)) {
        if (hasCycle(dep, visited, stack)) return true;
      } else if (stack.has(dep)) {
        issues.push(
          error(feature, node, `Circular dependency: ${node} → ${dep}`),
        );
        return true;
      }
    }
    stack.delete(node);
    return false;
  }

  const visited = new Set();
  for (const id of storyIds) {
    if (!visited.has(id)) {
      hasCycle(id, visited, new Set());
    }
  }

  // 9. Parallel cluster validation
  const parallelMatches = stories[0]?.raw ? [] : [];
  // (parallel clusters are advisory, not validated beyond syntax)

  return issues;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const singleFeature = args.find((a) => !a.startsWith("--"));
  const verbose = args.includes("--verbose") || args.includes("-v");

  console.log(
    `\n${BOLD}${CYAN}🔍 Granular Stories Linter — Jobzooka${RESET}\n`,
  );

  // Load shared story IDs
  let commonIds = [];
  if (fs.existsSync(COMMON_PATH)) {
    const commonContent = fs.readFileSync(COMMON_PATH, "utf-8");
    commonIds = extractCommonIds(commonContent);
    if (verbose) {
      console.log(
        `${DIM}Loaded ${commonIds.length} shared stories: ${commonIds.join(", ")}${RESET}\n`,
      );
    }
  }

  // Discover features
  let featureDirs;
  if (singleFeature) {
    const dir = path.join(FEATURES_DIR, singleFeature);
    if (!fs.existsSync(dir)) {
      console.error(`${RED}Feature not found: ${singleFeature}${RESET}`);
      process.exit(1);
    }
    featureDirs = [singleFeature];
  } else {
    featureDirs = fs
      .readdirSync(FEATURES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  const allIssues = [];
  let totalStories = 0;
  let totalErrors = 0;
  let totalWarns = 0;
  let totalInfos = 0;
  let featuresWithStories = 0;

  for (const feature of featureDirs) {
    const storiesPath = path.join(FEATURES_DIR, feature, "STORIES.md");
    if (!fs.existsSync(storiesPath)) {
      if (verbose) {
        allIssues.push(
          info(feature, "-", "STORIES.md not found (not yet written)"),
        );
      }
      continue;
    }

    featuresWithStories++;
    const content = fs.readFileSync(storiesPath, "utf-8");
    const stories = extractStories(content);
    totalStories += stories.length;

    // Load HL story IDs for parent validation
    let hlIds = [];
    const hlPath = path.join(FEATURES_DIR, feature, "HL-STORIES.md");
    if (fs.existsSync(hlPath)) {
      const hlContent = fs.readFileSync(hlPath, "utf-8");
      hlIds = extractHLStoryIds(hlContent);
    }

    const storyIssues = checkStories(feature, stories, hlIds, commonIds);
    allIssues.push(...storyIssues);
  }

  // ── Report ──────────────────────────────────────────────────────────────

  const grouped = {};
  for (const issue of allIssues) {
    const key = issue.feature;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(issue);
  }

  for (const [feature, issues] of Object.entries(grouped)) {
    const errors = issues.filter((i) => i.level === "error");
    const warns = issues.filter((i) => i.level === "warn");

    totalErrors += errors.length;
    totalWarns += warns.length;
    totalInfos += issues.filter((i) => i.level === "info").length;

    if (errors.length === 0 && warns.length === 0 && !verbose) continue;

    const badge =
      errors.length > 0
        ? `${RED}✗${RESET}`
        : warns.length > 0
          ? `${YELLOW}⚠${RESET}`
          : `${GREEN}✓${RESET}`;

    console.log(`${badge} ${BOLD}${feature}${RESET}`);

    for (const issue of issues) {
      if (issue.level === "info" && !verbose) continue;
      const icon =
        issue.level === "error"
          ? `  ${RED}✗${RESET}`
          : issue.level === "warn"
            ? `  ${YELLOW}⚠${RESET}`
            : `  ${DIM}ℹ${RESET}`;
      const storyRef = issue.storyId !== "-" ? ` [${issue.storyId}]` : "";
      console.log(`${icon}${storyRef} ${issue.msg}`);
    }
    console.log();
  }

  // Clean features
  const cleanFeatures = featureDirs.filter((f) => {
    const storiesPath = path.join(FEATURES_DIR, f, "STORIES.md");
    if (!fs.existsSync(storiesPath)) return false;
    return !grouped[f] || grouped[f].every((i) => i.level === "info");
  });
  if (cleanFeatures.length > 0 && !verbose) {
    console.log(
      `${GREEN}✓${RESET} ${DIM}${cleanFeatures.join(", ")} — clean${RESET}\n`,
    );
  }

  // Summary
  console.log(
    `${BOLD}Summary:${RESET} ${featuresWithStories} features with stories, ${totalStories} stories`,
  );
  console.log(
    `  ${RED}${totalErrors} errors${RESET}  ${YELLOW}${totalWarns} warnings${RESET}  ${DIM}${totalInfos} info${RESET}`,
  );

  if (totalErrors > 0) {
    console.log(
      `\n${RED}${BOLD}FAIL${RESET} — Fix errors before proceeding.\n`,
    );
    process.exit(1);
  } else if (totalWarns > 0) {
    console.log(
      `\n${YELLOW}${BOLD}WARN${RESET} — Review warnings. May be false positives.\n`,
    );
    process.exit(0);
  } else {
    console.log(`\n${GREEN}${BOLD}PASS${RESET} — All stories valid.\n`);
    process.exit(0);
  }
}

main();
