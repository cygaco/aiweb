/**
 * diff.js — minimal LCS-based line diff for the CLI's pre-save preview.
 */

"use strict";

function diffStrings(a, b) {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      out.push({
        kind: "context",
        text: aLines[i],
        oldLine: i + 1,
        newLine: j + 1,
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({
        kind: "remove",
        text: aLines[i],
        oldLine: i + 1,
        newLine: null,
      });
      i++;
    } else {
      out.push({ kind: "add", text: bLines[j], oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  while (i < m) {
    out.push({
      kind: "remove",
      text: aLines[i],
      oldLine: i + 1,
      newLine: null,
    });
    i++;
  }
  while (j < n) {
    out.push({ kind: "add", text: bLines[j], oldLine: null, newLine: j + 1 });
    j++;
  }
  return out;
}

const HUNK_CONTEXT = 3;

function buildHunks(lines) {
  const changedIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== "context") changedIdx.push(i);
  }
  if (changedIdx.length === 0) return [];
  const hunks = [];
  let curStart = Math.max(0, changedIdx[0] - HUNK_CONTEXT);
  let curEnd = Math.min(lines.length - 1, changedIdx[0] + HUNK_CONTEXT);
  for (let k = 1; k < changedIdx.length; k++) {
    const idx = changedIdx[k];
    if (idx - HUNK_CONTEXT <= curEnd + 1) {
      curEnd = Math.min(lines.length - 1, idx + HUNK_CONTEXT);
    } else {
      hunks.push(lines.slice(curStart, curEnd + 1));
      curStart = Math.max(0, idx - HUNK_CONTEXT);
      curEnd = Math.min(lines.length - 1, idx + HUNK_CONTEXT);
    }
  }
  hunks.push(lines.slice(curStart, curEnd + 1));
  return hunks;
}

function fileDiff(p, before, after) {
  const lines = diffStrings(before, after);
  const hunks = buildHunks(lines);
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "remove") removed++;
  }
  return { path: p, hunks, added, removed };
}

module.exports = { diffStrings, buildHunks, fileDiff };
