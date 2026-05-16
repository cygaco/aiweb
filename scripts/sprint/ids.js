#!/usr/bin/env node

/**
 * scripts/sprint/ids.js — Sprint id generators.
 *
 * Sprint v0.1 id schemes:
 *   Sprint                    SP-YYYYMMDD-NNN
 *   Plan Contract             PC-YYYYMMDD-NNNN
 *   Ticket                    T-YYYYMMDD-NNN
 *   Issue                     I-YYYYMMDD-NNN
 *   External Service Dep      ESD-YYYYMMDD-NNN
 *   Approval                  AP-YYYYMMDD-NNN
 *   Release                   RL-YYYYMMDD-NNN
 *
 * Suffixes are repo-wide counters, computed by scanning the existing
 * yaml files in the relevant directory. Fail-safe: if no files exist,
 * counter starts at 001 (or 0001 for PC).
 */

"use strict";

const fs = require("fs");
const path = require("path");

function todayUTC() {
  const d = new Date();
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function nextSuffix(dir, prefix, width = 3) {
  let max = 0;
  try {
    if (fs.existsSync(dir)) {
      const re = new RegExp(`^${prefix}-(\\d{8})-(\\d{${width}})`);
      for (const f of fs.readdirSync(dir)) {
        const m = re.exec(f);
        if (m) {
          const n = parseInt(m[2], 10);
          if (n > max) max = n;
        }
      }
    }
  } catch {
    // fall through; suffix counter is local — start at 1 on error
  }
  return String(max + 1).padStart(width, "0");
}

function generate(prefix, dir, width = 3) {
  const date = todayUTC();
  const suffix = nextSuffix(dir, prefix, width);
  return `${prefix}-${date}-${suffix}`;
}

function sprintId(historyDir) {
  return generate("SP", historyDir, 3);
}

function planContractId(planContractsDir) {
  return generate("PC", planContractsDir, 4);
}

function ticketId(ticketsDir) {
  return generate("T", ticketsDir, 3);
}

function issueId(issuesDir) {
  return generate("I", issuesDir, 3);
}

function esdId(esdDir) {
  return generate("ESD", esdDir, 3);
}

function approvalId(approvalsDir) {
  return generate("AP", approvalsDir, 3);
}

function releaseId(releasesDir) {
  return generate("RL", releasesDir, 3);
}

module.exports = {
  todayUTC,
  generate,
  sprintId,
  planContractId,
  ticketId,
  issueId,
  esdId,
  approvalId,
  releaseId,
};

// CLI for testing.
if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.log("usage: ids.js <prefix> [<dir>] [<width>]");
    process.exit(1);
  }
  const dir = process.argv[3] || ".";
  const width = parseInt(process.argv[4] || "3", 10);
  console.log(generate(arg, dir, width));
}
