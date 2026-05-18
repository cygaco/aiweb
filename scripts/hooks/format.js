#!/usr/bin/env node
// PostToolUse hook: runs prettier on the changed file after Edit/Write
// Keeps formatting consistent without manual intervention.
//
// SP-20260517-005 / RT format-hook-wipe — `prettier --write` is NOT
// atomic: it truncates the destination file at the start of its write
// phase, then computes/writes formatted output. When execSync's 10s
// timeout fires mid-operation (large file + npx cold-start), prettier
// is SIGTERMed and the file is left at 0 bytes. The fix here:
//   1. Read original content into memory BEFORE invoking prettier.
//   2. After prettier, if the file is 0 bytes or smaller than 50% of
//      the original, restore from the in-memory backup.
//   3. Log every restore + every prettier error to events.jsonl so
//      the audit trail exists (the prior silent fail-open hid the
//      bug class for months).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function logEvent(repoRoot, record) {
  try {
    const eventsFile = path.join(repoRoot, "runtime", "events.jsonl");
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.appendFileSync(eventsFile, JSON.stringify(record) + "\n");
  } catch {
    // Don't break the hook if logging fails.
  }
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let event;
  let filePath;
  let cwd;
  try {
    event = JSON.parse(input);
    filePath =
      event.tool_input?.file_path || event.tool_input?.content?.file_path;
    cwd = event.cwd;
  } catch {
    process.exit(0);
  }

  if (!filePath || !/\.(ts|tsx|js|jsx|json|css)$/.test(filePath)) {
    process.exit(0);
  }

  // Capture the original content BEFORE prettier touches the file, so
  // we can restore if prettier truncates and exits.
  let originalBytes = null;
  let originalSize = 0;
  try {
    originalBytes = fs.readFileSync(filePath);
    originalSize = originalBytes.length;
  } catch {
    // File doesn't exist yet (rare — Edit/Write should have created it).
    // Skip formatting; nothing to back up.
    process.exit(0);
  }

  // Skip prettier entirely for empty files (nothing to format).
  if (originalSize === 0) process.exit(0);

  let prettierError = null;
  try {
    execSync(`npx prettier --write "${filePath}"`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
  } catch (err) {
    prettierError = {
      message: err.message,
      // execSync sets signal on timeout/SIGTERM.
      signal: err.signal ?? null,
      code: err.status ?? null,
    };
  }

  // Detect wipe / truncate: file went to 0 bytes OR < 50% of original.
  // 50% threshold catches partial-write corruption (prettier killed mid-write).
  let postSize = 0;
  try {
    postSize = fs.statSync(filePath).size;
  } catch {
    // File got deleted somehow.
    postSize = 0;
  }
  const wiped = postSize === 0 && originalSize > 0;
  const truncated = !wiped && postSize > 0 && postSize < originalSize * 0.5;
  const damaged = wiped || truncated;

  if (damaged) {
    // Restore from in-memory backup.
    try {
      fs.writeFileSync(filePath, originalBytes);
    } catch {
      // If even the restore fails, we have nothing left to do.
    }
  }

  if (prettierError || damaged) {
    logEvent(cwd, {
      ts: new Date().toISOString(),
      type: "format-hook.outcome",
      file: filePath,
      original_size: originalSize,
      post_prettier_size: postSize,
      wiped,
      truncated,
      restored: damaged,
      prettier_error: prettierError,
    });
  }

  process.exit(0);
});
