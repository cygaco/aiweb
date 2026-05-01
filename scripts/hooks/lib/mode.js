// scripts/hooks/lib/mode.js
// Shared mode-detection. Single source of truth for "what mode is the
// project in" — replaces duplicated reads of .claude/runtime/mode.json
// across beta-gate.js, smart-context.js, team-guard.js (P-07-05).
//
// Mode resolution order (matches team-guard.js, RT-013):
//   1. .claude/runtime/mode.json {mode: "adhoc" | "oneshot" | "solo"}
//   2. legacy heartbeat fallback (an adhoc team's heartbeat with
//      matching session-id)
//   3. default "solo"

const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./paths");

const MODE_FILE = path.join(PROJECT, ".claude", "runtime", "mode.json");
const SESSION_FILE = path.join(PROJECT, ".claude", "runtime", ".session-id");

/** Read .claude/runtime/mode.json. Returns the mode string lowercased,
 *  or null if missing/malformed. */
function readModeFile() {
  try {
    if (!fs.existsSync(MODE_FILE)) return null;
    const doc = JSON.parse(fs.readFileSync(MODE_FILE, "utf8"));
    if (typeof doc?.mode === "string") return doc.mode.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

/** Best-effort current session id. Returns "" if unavailable. */
function getCurrentSessionId() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, "utf8").trim();
    }
  } catch {
    /* fall through */
  }
  return "";
}

/** Returns true if an adhoc team's heartbeat matches the current session.
 *  Useful as a legacy fallback when mode.json is missing. */
function adhocHeartbeatMatches() {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const hb = path.join(home, ".claude", "teams", "adhoc", "heartbeat.json");
    if (!fs.existsSync(hb)) return false;
    const doc = JSON.parse(fs.readFileSync(hb, "utf8"));
    const sid = getCurrentSessionId();
    return Boolean(sid) && doc.sessionId === sid;
  } catch {
    return false;
  }
}

/** Resolve the active mode. Returns one of "adhoc" | "oneshot" | "solo". */
function getMode() {
  const explicit = readModeFile();
  if (explicit === "oneshot") return "oneshot";
  if (explicit === "solo") return "solo";
  if (explicit === "adhoc") return "adhoc";
  if (adhocHeartbeatMatches()) return "adhoc";
  return "solo";
}

const isAdhoc = () => getMode() === "adhoc";
const isOneshot = () => getMode() === "oneshot";
const isSolo = () => getMode() === "solo";

module.exports = {
  getMode,
  isAdhoc,
  isOneshot,
  isSolo,
  readModeFile,
  getCurrentSessionId,
  adhocHeartbeatMatches,
};
