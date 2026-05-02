#!/usr/bin/env node
// Compute similarity between builder output and master branch for branch theft detection.
// Usage: node scripts/branch-diff.js --feature <name> --files <comma-separated-paths>

const { execSync } = require("child_process");
const path = require("path");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const SIMILARITY_THRESHOLD = 0.7;

function usage() {
  process.stderr.write(
    `${YELLOW}Usage: node scripts/branch-diff.js --feature <name> --files <comma-separated-paths>${RESET}\n`,
  );
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let feature = null;
  let files = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--feature" && args[i + 1]) {
      feature = args[++i];
    } else if (args[i] === "--files" && args[i + 1]) {
      files = args[++i].split(",").map((f) => f.trim());
    }
  }

  if (!feature || !files || files.length === 0) usage();
  return { feature, files };
}

function countLines(text) {
  if (!text || text.trim() === "") return 0;
  return text.split("\n").length;
}

function countDiffLines(diffOutput) {
  if (!diffOutput || diffOutput.trim() === "") return 0;
  let changed = 0;
  const lines = diffOutput.split("\n");
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) changed++;
    if (line.startsWith("-") && !line.startsWith("---")) changed++;
  }
  return changed;
}

function getFileLines(filePath) {
  try {
    const content = execSync(`git show HEAD:"${filePath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return countLines(content);
  } catch {
    return 0;
  }
}

function analyzeFile(filePath) {
  const repoRoot = path.resolve(__dirname, "..");

  // Diff between master and current file (how different is it from master?)
  let masterDiff = "";
  try {
    masterDiff = execSync(`git diff master -- "${filePath}"`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // File may not exist on master — that's fine, means it's new
    return {
      path: filePath,
      similarity: 0,
      suspected_copy: false,
      note: "new file",
    };
  }

  const totalLines = getFileLines(filePath);
  if (totalLines === 0) {
    return {
      path: filePath,
      similarity: 0,
      suspected_copy: false,
      note: "empty file",
    };
  }

  const diffLines = countDiffLines(masterDiff);

  // If diff is small relative to total lines, the file is very similar to master
  // similarity = 1 - (changed lines / (2 * total lines))
  // Factor of 2 because diff counts both additions and deletions
  const changeRatio = diffLines / (2 * totalLines);
  const similarity = Math.max(0, Math.min(1, 1 - changeRatio));
  const similarityRounded = Math.round(similarity * 1000) / 1000;

  const suspected_copy = similarity > SIMILARITY_THRESHOLD;

  return {
    path: filePath,
    similarity: similarityRounded,
    suspected_copy,
  };
}

function main() {
  const { feature, files } = parseArgs();

  const results = [];
  let anyCopy = false;

  for (const filePath of files) {
    const result = analyzeFile(filePath);
    results.push(result);
    if (result.suspected_copy) anyCopy = true;
  }

  if (anyCopy) {
    process.stderr.write(
      `${RED}[branch-diff] WARNING: Suspected copy detected for feature "${feature}"${RESET}\n`,
    );
    for (const r of results) {
      if (r.suspected_copy) {
        process.stderr.write(
          `${RED}  - ${r.path}: ${(r.similarity * 100).toFixed(1)}% similar to master${RESET}\n`,
        );
      }
    }
  } else {
    process.stderr.write(
      `${GREEN}[branch-diff] OK: No suspected copies for "${feature}"${RESET}\n`,
    );
  }

  const output = { feature, files: results };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main();
