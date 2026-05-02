/**
 * active-run.js — detect whether a oneshot run is in flight.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = process.cwd();
const RUN_FILE = path.join(PROJECT_ROOT, ".claude", "runtime", "run.json");
const HEARTBEAT_FILE = path.join(
  PROJECT_ROOT,
  ".claude",
  "runtime",
  "oneshot-heartbeat.json",
);
const HEAD_FILE = path.join(PROJECT_ROOT, ".git", "HEAD");

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function readCurrentBranch() {
  try {
    const head = fs.readFileSync(HEAD_FILE, "utf8");
    const m = head.match(/ref:\s+refs\/heads\/(.+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function formatAge(ms) {
  if (!isFinite(ms)) return "ages";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

function getActiveRunStatus() {
  const runJson = readJsonSafe(RUN_FILE) || {};
  const heartbeatStat = statSafe(HEARTBEAT_FILE);
  const runStat = statSafe(RUN_FILE);
  const branch = readCurrentBranch();

  const runNumber = runJson.runNumber || null;
  const skeletonBranch = runJson.skeletonBranch || null;
  const now = Date.now();
  const heartbeatAge = heartbeatStat ? now - heartbeatStat.mtimeMs : Infinity;
  const runAge = runStat ? now - runStat.mtimeMs : Infinity;
  const lastSignalAge = Math.min(heartbeatAge, runAge);

  const branchMatches =
    !!skeletonBranch &&
    !!branch &&
    skeletonBranch === branch &&
    /^skeleton-test\d+$/.test(branch);
  const recent = lastSignalAge < ACTIVE_WINDOW_MS;

  let reason = "no active oneshot";
  let isActive = false;
  if (branchMatches && recent) {
    isActive = true;
    reason = `Run #${runNumber} (${skeletonBranch}) — last activity ${formatAge(lastSignalAge)} ago`;
  } else if (branchMatches) {
    reason = `On ${skeletonBranch}, last activity ${formatAge(lastSignalAge)} ago — likely idle`;
  } else {
    reason = `Current branch is ${branch || "unknown"} — not on a skeleton branch`;
  }

  return {
    isActive,
    runNumber,
    skeletonBranch,
    currentBranch: branch,
    lastSignalAgeMs: lastSignalAge === Infinity ? null : lastSignalAge,
    reason,
  };
}

module.exports = { getActiveRunStatus };
