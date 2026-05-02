#!/usr/bin/env node

/**
 * PRD Linter — Automated validation for Jobzooka feature PRDs.
 *
 * Checks:
 *   1. STRUCTURAL  — All 16 sections present, non-empty, format rules
 *   2. CROSS-PRD   — Rocket costs match code, file ownership, dependency DAG
 *   3. CODE DRIFT  — File paths in PRDs exist on disk, unclaimed source files
 *
 * Usage:
 *   node scripts/lint-prds.js            # lint all PRDs
 *   node scripts/lint-prds.js onboarding # lint one feature
 *   node scripts/lint-prds.js --fix      # auto-fix trivial issues (future)
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./hooks/lib/paths");

// ── Config ───────────────────────────────────────────────────────────────

const ROOT = PROJECT;
const FEATURES_DIR = PATHS.specsRoot || path.join(ROOT, "requirements", "05-features");
const SRC_DIR = path.join(ROOT, "src");

const REQUIRED_SECTIONS = [
  "1. Title + Classification",
  "2. Screen",
  "3. Context",
  "4. JTBD (Jobs To Be Done)",
  "5. Emotional Framing",
  "6. Goals",
  "7. Assumptions",
  "8. Feature Description",
  "9. Dependencies / Blockers",
  "10. Rocket Cost",
  "11. Competitiveness Impact",
  "12. UI Reference",
  "13. Implementation Map",
  "14. Test Plan",
  "15. Out of Scope",
  "16. Open Questions",
];

// Section name aliases (PRDs may use alternate names)
const SECTION_ALIASES = {
  "open questions": "decisions",
};

// Before/after language that leaks planning context into Feature Description
const BEFORE_AFTER_PATTERNS = [
  /\bcurrently\b/i,
  /\bbefore this\b/i,
  /\bafter this\b/i,
  /\bpreviously\b/i,
  /\bused to\b/i,
  /\bwill now\b/i,
  /\binstead of\b/i,
  /\breplaces?\b/i,
  /\bno longer\b/i,
  /\bnew(?:ly)?\s+(?:added|introduced|implemented)\b/i,
  /\bupgraded?\b/i,
  /\bmigrat(?:ed?|ing)\b/i,
];

// Allowlist: patterns that look like before/after but are valid feature language
const BEFORE_AFTER_ALLOWLIST = [
  /before (?:each|every|any|the user|submitting|clicking|applying|starting|generating)/i,
  /after (?:each|every|any|the user|completing|clicking|parsing|confirming|generating|payment)/i,
  /currently (?:employed|available|active)/i,
  /replace(?:s|ment)? (?:text|content|all|the)/i,
];

// Rocket costs from src/lib/rockets.ts — source of truth
const CODE_ROCKET_COSTS = {
  targetedResume: 50,
  linkedinRewrite: 75,
  rerunMarket: 50,
  rerunResumes: 50,
  rerunLinkedin: 50,
  autoApplySession: 0,
  freeTier: 150,
};

// ── Helpers ──────────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function error(feature, msg) {
  return { level: "error", feature, msg };
}
function warn(feature, msg) {
  return { level: "warn", feature, msg };
}
function info(feature, msg) {
  return { level: "info", feature, msg };
}

function extractSections(content) {
  const sections = {};
  const lines = content.replace(/\r/g, "").split("\n");
  let currentSection = null;
  let currentBody = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(\d+)\.\s+(.+?)(?:\s+`\[.*\]`)?$/);
    if (match) {
      if (currentSection) {
        sections[currentSection] = currentBody.join("\n").trim();
      }
      currentSection = `${match[1]}. ${match[2].trim()}`;
      currentBody = [];
    } else if (currentSection) {
      currentBody.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection] = currentBody.join("\n").trim();
  }
  return sections;
}

function extractFilePaths(text) {
  const paths = [];
  // Match backtick-wrapped paths like `src/lib/foo.ts`
  const backtickMatches = text.matchAll(/`(src\/[^`]+)`/g);
  for (const m of backtickMatches) {
    paths.push(m[1]);
  }
  return [...new Set(paths)];
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function getAllSrcFiles() {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else {
        results.push(path.relative(ROOT, full).replace(/\\/g, "/"));
      }
    }
  }
  walk(SRC_DIR);
  return results;
}

// ── Structural Checks ────────────────────────────────────────────────────

function checkStructural(feature, content, sections) {
  const issues = [];

  // 1. All 16 sections present
  for (const req of REQUIRED_SECTIONS) {
    const sectionName = req.replace(/^\d+\.\s+/, "").toLowerCase();
    const alias = SECTION_ALIASES[sectionName];
    const found = Object.keys(sections).some((k) => {
      const actual = k.replace(/^\d+\.\s+/, "").toLowerCase();
      return actual === sectionName || actual === alias;
    });
    if (!found) {
      issues.push(error(feature, `Missing section: ## ${req}`));
    }
  }

  // 2. No section is empty (unless n/a)
  for (const [name, body] of Object.entries(sections)) {
    if (!body || body.trim().length === 0) {
      issues.push(
        error(
          feature,
          `Section "${name}" is empty — use n/a if not applicable`,
        ),
      );
    }
  }

  // 3. Classification present (MVP or Post-MVP)
  const titleSection = sections["1. Title + Classification"] || "";
  if (!/\bMVP\b/.test(titleSection) && !/\bPost-MVP\b/.test(titleSection)) {
    issues.push(
      error(
        feature,
        "Section 1 missing classification: must contain 'MVP' or 'Post-MVP'",
      ),
    );
  }

  // 4. JTBD format: "When ... I want to ... so I can ..."
  const jtbd =
    sections["4. JTBD (Jobs To Be Done)"] || sections["4. JTBD"] || "";
  if (jtbd && jtbd !== "n/a") {
    const jtbdBlocks = jtbd.split(/\n>\s*\n/).filter(Boolean);
    const rawQuotes = jtbd.match(/^>\s*.+/gm) || [];

    // Combine multi-line blockquotes
    let combinedQuotes = [];
    let current = "";
    for (const line of jtbd.split("\n")) {
      if (line.match(/^>\s+When\b/i)) {
        if (current) combinedQuotes.push(current);
        current = line.replace(/^>\s*/, "");
      } else if (line.match(/^>\s+/) && current) {
        current += " " + line.replace(/^>\s*/, "");
      } else if (current) {
        combinedQuotes.push(current);
        current = "";
      }
    }
    if (current) combinedQuotes.push(current);

    if (combinedQuotes.length === 0) {
      issues.push(
        error(
          feature,
          "JTBD section has no blockquoted jobs (use > When ... format)",
        ),
      );
    }
    for (const quote of combinedQuotes) {
      if (!/when\b/i.test(quote)) {
        issues.push(
          warn(feature, `JTBD missing "When": "${quote.slice(0, 60)}..."`),
        );
      }
      if (!/i want\b/i.test(quote)) {
        issues.push(
          warn(
            feature,
            `JTBD missing "I want [to]": "${quote.slice(0, 60)}..."`,
          ),
        );
      }
      if (!/so I can\b/i.test(quote)) {
        issues.push(
          warn(feature, `JTBD missing "so I can": "${quote.slice(0, 60)}..."`),
        );
      }
    }
  }

  // 5. Emotional Framing has Entry/During/Exit
  const emo = sections["5. Emotional Framing"] || "";
  if (emo && emo !== "n/a") {
    if (!/entry/i.test(emo))
      issues.push(error(feature, "Emotional Framing missing **Entry** state"));
    if (!/during/i.test(emo))
      issues.push(error(feature, "Emotional Framing missing **During** state"));
    if (!/exit/i.test(emo))
      issues.push(error(feature, "Emotional Framing missing **Exit** state"));
  }

  // 6. Feature Description — no before/after language
  const featureDesc = sections["8. Feature Description"] || "";
  if (featureDesc) {
    for (const pattern of BEFORE_AFTER_PATTERNS) {
      const matches = featureDesc.match(new RegExp(pattern.source, "gi"));
      if (matches) {
        for (const match of matches) {
          // Check allowlist
          const context = featureDesc.slice(
            Math.max(0, featureDesc.indexOf(match) - 30),
            featureDesc.indexOf(match) + match.length + 30,
          );
          const allowed = BEFORE_AFTER_ALLOWLIST.some((a) => a.test(context));
          if (!allowed) {
            issues.push(
              warn(
                feature,
                `Feature Description may contain before/after language: "${match}" in "...${context.trim()}..."`,
              ),
            );
          }
        }
      }
    }
  }

  // 7. No user stories embedded
  if (/\bas a (?:user|job seeker|developer|admin)\b/i.test(content)) {
    issues.push(
      warn(
        feature,
        "PRD may contain embedded user stories (found 'As a user/...' pattern). Stories belong in separate files.",
      ),
    );
  }

  // 8. Goals should be concrete (check for vague words)
  const goals = sections["6. Goals"] || "";
  const vaguePatterns = [
    /\bimprove\b/i,
    /\benhance\b/i,
    /\bbetter\b/i,
    /\bgood\b/i,
  ];
  for (const vp of vaguePatterns) {
    if (vp.test(goals)) {
      issues.push(
        warn(
          feature,
          `Goals section contains vague language: "${goals.match(vp)?.[0]}". Goals should be concrete and measurable.`,
        ),
      );
    }
  }

  return issues;
}

// ── File Path Checks ─────────────────────────────────────────────────────

function checkFilePaths(feature, sections) {
  const issues = [];

  // Implementation Map file paths exist
  const implMap = sections["13. Implementation Map"] || "";
  const implPaths = extractFilePaths(implMap);
  for (const p of implPaths) {
    // Allow "New file" entries
    if (!fileExists(p)) {
      const lineWithPath = implMap.split("\n").find((l) => l.includes(p));
      if (lineWithPath && /\bnew\b/i.test(lineWithPath)) {
        issues.push(
          info(feature, `Implementation Map: ${p} marked as new file (OK)`),
        );
      } else {
        issues.push(
          error(
            feature,
            `Implementation Map references non-existent file: ${p}`,
          ),
        );
      }
    }
  }

  return issues;
}

// ── Cross-PRD Checks ─────────────────────────────────────────────────────

function checkCrossPRD(allPRDs) {
  const issues = [];

  // 1. Collect all file claims
  const fileClaims = {}; // filepath → [{feature, change}]
  for (const [feature, { sections }] of Object.entries(allPRDs)) {
    const implMap = sections["13. Implementation Map"] || "";
    const rows = implMap
      .split("\n")
      .filter((l) => l.startsWith("|") && !l.includes("---"));
    for (const row of rows) {
      const cells = row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 2) {
        const filePaths = extractFilePaths("`" + cells[0] + "`");
        for (const fp of filePaths) {
          if (!fileClaims[fp]) fileClaims[fp] = [];
          fileClaims[fp].push({ feature, change: cells[1] });
        }
      }
    }
  }

  // Flag files claimed by multiple PRDs with different changes
  for (const [fp, claims] of Object.entries(fileClaims)) {
    if (claims.length > 1) {
      const features = claims.map((c) => c.feature).join(", ");
      issues.push(
        info(
          "CROSS-PRD",
          `${fp} claimed by multiple PRDs: ${features}. Verify changes don't conflict.`,
        ),
      );
    }
  }

  // 2. Rocket cost cross-check
  const rocketsPRD = allPRDs["rockets-economy"];
  if (rocketsPRD) {
    const featureDesc = rocketsPRD.sections["8. Feature Description"] || "";

    // Check targeted resume cost
    if (
      featureDesc.includes("50 per category") &&
      CODE_ROCKET_COSTS.targetedResume !== 50
    ) {
      issues.push(
        error(
          "CROSS-PRD",
          `Rockets PRD says targeted resume = 50, but code says ${CODE_ROCKET_COSTS.targetedResume}`,
        ),
      );
    }

    // Check LinkedIn cost
    if (
      featureDesc.includes("75 rockets") &&
      CODE_ROCKET_COSTS.linkedinRewrite !== 75
    ) {
      issues.push(
        error(
          "CROSS-PRD",
          `Rockets PRD says LinkedIn = 75, but code says ${CODE_ROCKET_COSTS.linkedinRewrite}`,
        ),
      );
    }

    // Check free tier
    if (
      featureDesc.includes("150 free rockets") &&
      CODE_ROCKET_COSTS.freeTier !== 150
    ) {
      issues.push(
        error(
          "CROSS-PRD",
          `Rockets PRD says free tier = 150, but code says ${CODE_ROCKET_COSTS.freeTier}`,
        ),
      );
    }

    // Check individual PRDs match
    for (const [feature, { sections }] of Object.entries(allPRDs)) {
      if (feature === "rockets-economy") continue;
      const rocketCost = sections["10. Rocket Cost"] || "";
      if (rocketCost !== "n/a" && rocketCost.trim() !== "n/a") {
        // Extract numbers
        const nums = rocketCost.match(/(\d+)\s*rockets?/gi);
        if (nums) {
          for (const numMatch of nums) {
            const num = parseInt(numMatch);
            // Verify against known costs
            // Known costs: 50 (targeted), 75 (linkedin), 35/25 (tiered discounts), 100/150 (packs/free tier)
            if (num > 0 && ![25, 35, 50, 75, 100, 150].includes(num)) {
              issues.push(
                warn(
                  feature,
                  `Rocket cost ${num} doesn't match any known cost tier (50/75/100/150)`,
                ),
              );
            }
          }
        }
      }
    }
  }

  // 3. Dependency DAG — check for circular deps
  const deps = {};
  for (const [feature, { sections }] of Object.entries(allPRDs)) {
    const depSection = sections["9. Dependencies / Blockers"] || "";
    deps[feature] = [];
    for (const [otherFeature] of Object.entries(allPRDs)) {
      if (otherFeature !== feature) {
        // Check if this PRD mentions the other feature as a dependency
        const featureWords = otherFeature.replace(/-/g, " ");
        if (
          depSection.toLowerCase().includes(featureWords) ||
          depSection.toLowerCase().includes(otherFeature)
        ) {
          deps[feature].push(otherFeature);
        }
      }
    }
  }

  // Known co-dependent feature pairs (intentional coupling, not bugs)
  const KNOWN_CODEPS = new Set([
    "auto-apply:extension",
    "extension:auto-apply",
    "auto-apply:backend",
    "backend:auto-apply",
    "backend:extension",
    "extension:backend",
    "profile:onboarding",
    "onboarding:profile",
  ]);

  // Simple cycle detection via DFS
  function hasCycle(node, visited, stack) {
    visited.add(node);
    stack.add(node);
    for (const dep of deps[node] || []) {
      if (!visited.has(dep)) {
        if (hasCycle(dep, visited, stack)) return true;
      } else if (stack.has(dep)) {
        const pair = `${node}:${dep}`;
        if (KNOWN_CODEPS.has(pair)) {
          issues.push(
            info("CROSS-PRD", `Known co-dependency: ${node} ↔ ${dep} (OK)`),
          );
        } else {
          issues.push(
            error(
              "CROSS-PRD",
              `Circular dependency detected: ${node} → ${dep}`,
            ),
          );
        }
        return true;
      }
    }
    stack.delete(node);
    return false;
  }

  const visited = new Set();
  for (const feature of Object.keys(deps)) {
    if (!visited.has(feature)) {
      hasCycle(feature, visited, new Set());
    }
  }

  return issues;
}

// ── Code Drift Checks ────────────────────────────────────────────────────

function checkCodeDrift(allPRDs) {
  const issues = [];

  // Collect all claimed source files from all PRDs
  const claimedFiles = new Set();
  for (const [, { sections }] of Object.entries(allPRDs)) {
    const im = sections["13. Implementation Map"] || "";
    for (const p of extractFilePaths(im)) claimedFiles.add(p);
  }

  // Get all actual source files
  const allSrcFiles = getAllSrcFiles();

  // Key source files that should be claimed (components, pages, lib, api routes)
  const keyPatterns = [
    /^src\/components\/steps\//,
    /^src\/components\/pages\//,
    /^src\/lib\/[^/]+\.ts$/,
    /^src\/app\/api\//,
  ];

  for (const srcFile of allSrcFiles) {
    const isKey = keyPatterns.some((p) => p.test(srcFile));
    if (isKey && !claimedFiles.has(srcFile)) {
      // Exclude test files, type declaration files, CSS
      if (srcFile.endsWith(".test.ts") || srcFile.endsWith(".d.ts")) continue;
      if (srcFile.endsWith(".css")) continue;
      // Exclude infrastructure files (cross-cutting, not feature-owned)
      const infraFiles = [
        "src/lib/pipeline.ts",
        "src/lib/validators.ts",
        "src/lib/scraper-scripts.ts",
        "src/app/api/test/route.ts",
      ];
      if (infraFiles.includes(srcFile)) continue;
      issues.push(
        warn("CODE-DRIFT", `Source file not claimed by any PRD: ${srcFile}`),
      );
    }
  }

  return issues;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const singleFeature = args.find((a) => !a.startsWith("--"));
  const verbose = args.includes("--verbose") || args.includes("-v");

  console.log(`\n${BOLD}${CYAN}🔍 PRD Linter — Jobzooka${RESET}\n`);

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

  const allPRDs = {};
  const allIssues = [];
  let totalErrors = 0;
  let totalWarns = 0;
  let totalInfos = 0;

  // Phase 1: Structural + file path checks per PRD
  for (const feature of featureDirs) {
    const prdPath = path.join(FEATURES_DIR, feature, "PRD.md");
    if (!fs.existsSync(prdPath)) {
      allIssues.push(error(feature, "PRD.md not found"));
      continue;
    }

    const content = fs.readFileSync(prdPath, "utf-8");
    const sections = extractSections(content);
    allPRDs[feature] = { content, sections };

    const structIssues = checkStructural(feature, content, sections);
    const fileIssues = checkFilePaths(feature, sections);
    allIssues.push(...structIssues, ...fileIssues);
  }

  // Phase 2: Cross-PRD checks (only if linting all)
  if (!singleFeature) {
    const crossIssues = checkCrossPRD(allPRDs);
    allIssues.push(...crossIssues);

    // Phase 3: Code drift checks
    const driftIssues = checkCodeDrift(allPRDs);
    allIssues.push(...driftIssues);
  }

  // ── Report ──────────────────────────────────────────────────────────────

  // Group by feature
  const grouped = {};
  for (const issue of allIssues) {
    if (!grouped[issue.feature]) grouped[issue.feature] = [];
    grouped[issue.feature].push(issue);
  }

  for (const [feature, issues] of Object.entries(grouped)) {
    const errors = issues.filter((i) => i.level === "error");
    const warns = issues.filter((i) => i.level === "warn");
    const infos = issues.filter((i) => i.level === "info");

    totalErrors += errors.length;
    totalWarns += warns.length;
    totalInfos += infos.length;

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
      console.log(`${icon} ${issue.msg}`);
    }
    console.log();
  }

  // Features with no issues
  if (!singleFeature) {
    const cleanFeatures = featureDirs.filter(
      (f) => !grouped[f] || grouped[f].every((i) => i.level === "info"),
    );
    if (cleanFeatures.length > 0 && !verbose) {
      console.log(
        `${GREEN}✓${RESET} ${DIM}${cleanFeatures.join(", ")} — clean${RESET}\n`,
      );
    }
  }

  // Summary
  console.log(`${BOLD}Summary:${RESET} ${featureDirs.length} PRDs scanned`);
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
    console.log(`\n${GREEN}${BOLD}PASS${RESET} — All PRDs valid.\n`);
    process.exit(0);
  }
}

main();
