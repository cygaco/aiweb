#!/usr/bin/env node
/**
 * Contract versioning and breaking-change detector.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CONTRACT_DIR = path.join(ROOT, "requirements", "04-architecture", "contracts");

function rel(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, "/");
}

function listContracts() {
  if (!fs.existsSync(CONTRACT_DIR)) return [];
  return fs
    .readdirSync(CONTRACT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(CONTRACT_DIR, f));
}

function parseMeta(body) {
  const pick = (name) => {
    const m = body.match(new RegExp(`- \\*\\*${name}:\\*\\*\\s*([^\\n]+)`, "i"));
    return m ? m[1].trim() : null;
  };
  const usedBy = pick("used by");
  return {
    id: pick("id"),
    version: pick("version"),
    changeType: pick("changeType"),
    usedBy: usedBy ? usedBy.split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
}

function section(body, heading) {
  const marker = `## ${heading}`;
  const start = body.indexOf(marker);
  if (start === -1) return "";
  const rest = body.slice(start + marker.length);
  const next = rest.search(/\n##\s+/);
  return next === -1 ? rest : rest.slice(0, next);
}

function gitShowHead(fileRel) {
  try {
    return execSync(`git show HEAD:${fileRel}`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function check() {
  const findings = [];
  const notifications = [];
  const files = listContracts();
  if (files.length === 0) {
    return { ok: false, checked: 0, findings: [{ severity: "red", message: "no contract files found" }], notifications };
  }

  for (const file of files) {
    const fileRel = rel(file);
    const body = fs.readFileSync(file, "utf8");
    const meta = parseMeta(body);
    if (!meta.id) findings.push({ severity: "red", file: fileRel, message: "missing id metadata" });
    if (!meta.version || !/^\d+\.\d+\.\d+$/.test(meta.version)) {
      findings.push({ severity: "red", file: fileRel, message: "missing semver version metadata" });
    }
    if (!meta.changeType || !/^(none|patch|minor|major)$/i.test(meta.changeType)) {
      findings.push({ severity: "red", file: fileRel, message: "missing changeType metadata" });
    }
    if (!/## 7\. Versioning and compatibility/.test(body)) {
      findings.push({ severity: "red", file: fileRel, message: "missing Versioning and compatibility section" });
    }

    const previous = gitShowHead(fileRel);
    if (previous) {
      const before = parseMeta(previous);
      const shapeChanged = section(previous, "1. Shape") !== section(body, "1. Shape");
      const breakingChanged = section(previous, "4. Breaking changes") !== section(body, "4. Breaking changes");
      if ((shapeChanged || breakingChanged) && before.version === meta.version) {
        findings.push({
          severity: "red",
          file: fileRel,
          message: "contract shape or breaking-change text changed without a version bump",
        });
      }
      if (before.version && meta.version && before.version !== meta.version) {
        notifications.push({
          contract: meta.id || path.basename(file, ".md"),
          from: before.version,
          to: meta.version,
          notify: meta.usedBy,
        });
      }
    }
  }

  return { ok: findings.length === 0, checked: files.length, findings, notifications };
}

if (require.main === module) {
  const result = check();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`contract-versioning: ok (${result.checked} contracts)`);
    for (const n of result.notifications) {
      console.log(`  notify ${n.contract}: ${n.from} -> ${n.to} (${n.notify.join(", ") || "no consumers listed"})`);
    }
  } else {
    console.log(`contract-versioning: ${result.findings.length} finding(s)`);
    for (const f of result.findings) console.log(`  [${f.severity}] ${f.file || ""}: ${f.message}`);
  }
  process.exit(result.ok ? 0 : 2);
}

module.exports = { check };
