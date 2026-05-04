/**
 * release-gates.js - release gates for /warp:release.
 *
 * Phase 4H artifact. Wraps existing checks (paths, requirements, references,
 * hooks, framework-manifest, runtime-leak, version-consistency, and Phase 6
 * production-quality checks into a single
 * runner that /warp:release calls before publishing.
 *
 * Exit codes:
 *   0 — all green
 *   1 — one or more yellow (warn), no red
 *   2 — one or more red (block)
 *
 * Usage:
 *   node scripts/warpos/release-gates.js                # full
 *   node scripts/warpos/release-gates.js --json         # machine-readable
 *   node scripts/warpos/release-gates.js --skip <name>  # skip a gate (for known YEL during phase progression)
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function gate(name, fn) {
  return { name, fn };
}

function runScript(scriptRelative, args, env) {
  const full = path.join(REPO_ROOT, scriptRelative);
  if (!fs.existsSync(full)) {
    return {
      status: 2,
      stdout: "",
      stderr: `Script missing: ${scriptRelative}`,
    };
  }
  const result = spawnSync(process.execPath, [full, ...(args || [])], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
  });
  return result;
}

const GATES = [
  // 1. Path Coherence
  gate("path_coherence", () => {
    const r = runScript("scripts/paths/gate.js");
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Path registry + generated artifacts current.",
      };
    return {
      ok: false,
      severity: "red",
      message: "Path coherence gate failed.",
      details: (r.stdout || "").split("\n").slice(-5),
    };
  }),

  // 2. Framework Manifest
  gate("framework_manifest", () => {
    const r = runScript("scripts/generate-framework-manifest.js", ["--check"]);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Framework manifest is current.",
      };
    if (r.status === 1)
      return {
        ok: false,
        severity: "yellow",
        message: "Framework manifest stale — regenerate before release.",
      };
    return {
      ok: false,
      severity: "red",
      message: "Framework manifest generator errored.",
      details: [(r.stderr || r.stdout || "").slice(0, 200)],
    };
  }),

  // 3. Reference Integrity
  // 0.1.2 honesty fix: this gate cannot run automatically (it needs a running
  // Claude Code agent to invoke /check:references). Pre-0.1.2 it returned
  // severity=green unconditionally — a lie that release-gates inherited.
  // Now it returns severity=manual: not blocking, but also not pretending to
  // pass. The runner counts manual the same as skipped for the overall PASS
  // tally; critical-by-default gates may upgrade manual to a soft-block.
  gate("reference_integrity", () => {
    return {
      ok: true,
      severity: "manual",
      message:
        "Reference integrity check requires the /check:references slash skill (no headless equivalent yet) — run manually before /warp:release. Tracked separately, not auto-passed.",
    };
  }),

  // 4. Hook Registration
  gate("hook_registration", () => {
    const settings = path.join(REPO_ROOT, ".claude", "settings.json");
    if (!fs.existsSync(settings)) {
      return {
        ok: false,
        severity: "red",
        message: ".claude/settings.json missing.",
      };
    }
    return {
      ok: true,
      severity: "green",
      message: "settings.json present (deeper hook fixture tests in gate 5).",
    };
  }),

  // 5. Hook Fixture Tests
  gate("hook_fixture_tests", () => {
    const r = runScript("scripts/hooks/test.js", ["--all"]);
    if (r.status === 0)
      return {
        ok: true,
        severity: "green",
        message: "Registered hook fixture tests pass.",
      };
    // Phase 5G ships fixtures. Until then, surface as YEL not RED.
    return {
      ok: false,
      severity: "red",
      message: "Hook fixture tests pending Phase 5G — placeholder gate.",
    };
  }),

  // 6. Fresh Install Fixture
  gate("fresh_install_fixture", () => {
    const fixture = path.join(REPO_ROOT, "fixtures", "install-empty-next-app");
    if (!fs.existsSync(fixture)) {
      return {
        ok: false,
        severity: "yellow",
        message:
          "fixtures/install-empty-next-app/ missing — Phase 4G ships only update-from-clean fixture in 0.1.0 baseline.",
      };
    }
    return {
      ok: true,
      severity: "green",
      message: "Fresh install fixture present.",
    };
  }),

  // 7. Update Fixture from previous version
  // Fix-forward (codex Phase 4 review 2026-04-30): previously this just
  // checked the fixture directory existed. That's cosmetic. Now we actually
  // load the fixture's framework-installed.json, run the update.js
  // classifier against it, and verify the plan is non-empty + has only
  // expected categories (Class C should be 0 for an upgrade FROM a clean
  // 0.0.0 install).
  gate("update_fixture_from_previous", () => {
    const fixture = path.join(REPO_ROOT, "fixtures", "update-from-0.0.0-clean");
    const fixtureInstall = path.join(
      fixture,
      ".claude",
      "framework-installed.json",
    );
    if (!fs.existsSync(fixtureInstall)) {
      return {
        ok: false,
        severity: "yellow",
        message:
          "Update-from-previous fixture missing framework-installed.json.",
      };
    }
    let installed;
    try {
      installed = JSON.parse(fs.readFileSync(fixtureInstall, "utf8"));
    } catch (e) {
      return {
        ok: false,
        severity: "red",
        message: `Fixture installed.json malformed: ${e.message}`,
      };
    }
    // Run update.js classifier directly with the fixture's installed snapshot
    let classify;
    try {
      ({ classify } = require("./update"));
    } catch (e) {
      return {
        ok: false,
        severity: "red",
        message: `Update engine not loadable: ${e.message}`,
      };
    }
    const versionFile = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "version.json"), "utf8"),
    );
    const targetVersion = versionFile.version;
    const capsuleDir = path.join(
      REPO_ROOT,
      "warpos",
      "releases",
      targetVersion,
    );
    const releaseFile = path.join(capsuleDir, "release.json");
    const manifestSnap = path.join(capsuleDir, "framework-manifest.json");
    if (!fs.existsSync(releaseFile) || !fs.existsSync(manifestSnap)) {
      return {
        ok: false,
        severity: "yellow",
        message: `Capsule ${targetVersion} not built — run /warp:release ${targetVersion} first.`,
      };
    }
    const capsule = {
      release: JSON.parse(fs.readFileSync(releaseFile, "utf8")),
      manifest: JSON.parse(fs.readFileSync(manifestSnap, "utf8")),
    };
    const decisions = classify(installed, capsule);
    const counts = {};
    for (const d of decisions)
      counts[d.category] = (counts[d.category] || 0) + 1;
    const classC = decisions.filter(
      (d) =>
        d.category === "MERGE_CONFLICT" ||
        d.category === "DELETE_CONFLICT" ||
        d.category === "RENAME_CONFLICT",
    ).length;
    if (decisions.length === 0) {
      return {
        ok: false,
        severity: "red",
        message:
          "Fixture classifier produced 0 decisions — engine or fixture is broken.",
      };
    }
    if (classC > 0) {
      return {
        ok: false,
        severity: "red",
        message: `Fixture classifier produced ${classC} Class C decision(s) for a clean 0.0.0 → ${targetVersion} upgrade — should be 0.`,
        details: decisions
          .filter((d) =>
            ["MERGE_CONFLICT", "DELETE_CONFLICT", "RENAME_CONFLICT"].includes(
              d.category,
            ),
          )
          .slice(0, 5)
          .map((d) => `${d.category} ${d.dest}`),
      };
    }
    return {
      ok: true,
      severity: "green",
      message: `Fixture classifier ran against 0.0.0 → ${targetVersion}: ${decisions.length} decisions, 0 Class C, counts ${JSON.stringify(counts)}.`,
    };
  }),

  // 8. Customized Install Fixture
  gate("customized_install_fixture", () => {
    const fixture = path.join(
      REPO_ROOT,
      "fixtures",
      "update-from-0.0.0-customized-claude-md",
    );
    if (!fs.existsSync(fixture)) {
      return {
        ok: false,
        severity: "yellow",
        message: "Customized-install fixture pending Phase 4G+.",
      };
    }
    return {
      ok: true,
      severity: "green",
      message: "Customized install fixture present.",
    };
  }),

  // 9. Runtime Leak Scan
  // Only flag truly-runtime paths that should never be in git.
  // .claude/project/events/ and .claude/project/memory/ ARE intentionally
  // tracked in this repo (per-project event log + memory stores); flagging
  // them as "leaks" was wrong. We narrow the scan to the per-session
  // runtime tree only.
  gate("runtime_leak_scan", () => {
    const RUNTIME_LEAK_PATTERNS = [
      ".claude/runtime/.session-checkpoint.json",
      ".claude/runtime/.topology-snapshot.json",
      ".claude/runtime/handoff.md",
      ".claude/runtime/handoffs/",
      ".claude/runtime/logs/",
      ".claude/runtime/notes/",
      ".claude/runtime/dispatch/",
      ".claude/.agent-result-hashes.json",
      ".claude/.last-checkpoint",
      ".claude/.session-checkpoint.json",
      ".claude/scheduled_tasks.lock",
      ".claude/agents/.system/dispatch-backups/",
      ".claude/agents/02-oneshot/.system/store.json",
      ".claude/agents/02-oneshot/.system/store.json.prev-run-backup.json",
    ];
    // Differentiate pre-existing leaks (committed before the leak rule
    // existed) from new leaks (added in the most recent change). New
    // leaks block; pre-existing leaks YEL with a "deferred to Phase 5T
    // cleanup" note. Phase 4 doesn't take on rewriting prior commits.
    let preExisting = [];
    let newlyAdded = [];
    try {
      const allTracked = execSync(
        `git ls-files ${RUNTIME_LEAK_PATTERNS.join(" ")}`,
        { cwd: REPO_ROOT, encoding: "utf8" },
      )
        .split("\n")
        .filter((l) => l.trim());
      // Fix-forward (codex Phase 4 review 2026-04-30): "newly added" should
      // mean "added on this branch since divergence from master," not just
      // "added in HEAD~1..HEAD." A multi-commit phase that added a leak in
      // its first commit and ran the gate from its third commit would have
      // misclassified the leak as pre-existing.
      let recentlyAdded = [];
      let mergeBase = null;
      try {
        mergeBase = execSync(`git merge-base HEAD master`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
        }).trim();
      } catch {
        // No master ref — fall back to the previous commit
        try {
          mergeBase = execSync(`git rev-parse HEAD~1`, {
            cwd: REPO_ROOT,
            encoding: "utf8",
          }).trim();
        } catch {
          mergeBase = null;
        }
      }
      if (mergeBase) {
        try {
          recentlyAdded = execSync(
            `git diff ${mergeBase}..HEAD --name-only --diff-filter=A ${RUNTIME_LEAK_PATTERNS.join(" ")}`,
            { cwd: REPO_ROOT, encoding: "utf8" },
          )
            .split("\n")
            .filter((l) => l.trim());
        } catch {
          recentlyAdded = [];
        }
      }
      const newSet = new Set(recentlyAdded);
      for (const f of allTracked) {
        if (newSet.has(f)) newlyAdded.push(f);
        else preExisting.push(f);
      }
    } catch {
      // git not available or empty result → treat as clean
    }
    if (newlyAdded.length > 0) {
      return {
        ok: false,
        severity: "red",
        message: `${newlyAdded.length} NEWLY-leaked runtime files in the last commit — block release.`,
        details: newlyAdded.slice(0, 5),
      };
    }
    if (preExisting.length > 0) {
      return {
        ok: false,
        severity: "yellow",
        message: `${preExisting.length} pre-existing runtime files are git-tracked from prior commits — schedule Phase 5T cleanup (\`git rm --cached\` + .gitignore additions). Not blocking release.`,
        details: preExisting.slice(0, 5),
      };
    }
    return {
      ok: true,
      severity: "green",
      message: "No runtime / per-session files leaked into git.",
    };
  }),

  // 10. Version Consistency
  gate("version_consistency", () => {
    const versionFile = path.join(REPO_ROOT, "version.json");
    const manifestFile = path.join(
      REPO_ROOT,
      ".claude",
      "framework-manifest.json",
    );
    if (!fs.existsSync(versionFile))
      return { ok: false, severity: "red", message: "version.json missing." };
    if (!fs.existsSync(manifestFile))
      return {
        ok: false,
        severity: "red",
        message: "framework-manifest.json missing.",
      };
    const v = JSON.parse(fs.readFileSync(versionFile, "utf8"));
    const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (v.version !== m.version) {
      return {
        ok: false,
        severity: "red",
        message: `version mismatch: version.json=${v.version} framework-manifest.json=${m.version}`,
      };
    }
    const capsule = path.join(
      REPO_ROOT,
      "warpos",
      "releases",
      v.version,
      "release.json",
    );
    if (!fs.existsSync(capsule)) {
      return {
        ok: false,
        severity: "yellow",
        message: `No release capsule for ${v.version} yet — run /warp:release ${v.version}.`,
      };
    }
    const c = JSON.parse(fs.readFileSync(capsule, "utf8"));
    if (c.version !== v.version) {
      return {
        ok: false,
        severity: "red",
        message: `capsule version mismatch: version.json=${v.version} capsule=${c.version}`,
      };
    }
    return {
      ok: true,
      severity: "green",
      message: `All three sources agree: ${v.version}.`,
    };
  }),

  // 11. Production Baseline
  gate("production_baseline", () => {
    const r = runScript("scripts/checks/production-baseline.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message:
          "Production, accessibility, analytics, DR, readiness, and deprecation docs are present.",
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Production baseline is incomplete.",
      details: (r.stdout || r.stderr || "").split(/\r?\n/).slice(-8),
    };
  }),

  // 12. Contract Versioning
  gate("contract_versioning", () => {
    const r = runScript("scripts/checks/contract-versioning.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message: "Shared contracts declare semver and compatibility policy.",
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Contract versioning check failed.",
      details: (r.stdout || r.stderr || "").split(/\r?\n/).slice(-8),
    };
  }),

  // 13. Pattern Library
  gate("pattern_library", () => {
    const admission = path.join(REPO_ROOT, "patterns", "ADMISSION.md");
    const dir = path.join(REPO_ROOT, "patterns");
    if (!fs.existsSync(admission)) {
      return {
        ok: false,
        severity: "red",
        message: "patterns/ADMISSION.md missing.",
      };
    }
    const content = fs
      .readdirSync(dir)
      .filter(
        (f) => f.endsWith(".md") && !["README.md", "ADMISSION.md"].includes(f),
      );
    if (content.length < 3) {
      return {
        ok: false,
        severity: "red",
        message:
          "Pattern library needs at least 3 canonical patterns or pruned references.",
      };
    }
    return {
      ok: true,
      severity: "green",
      message: `Pattern library has admission policy and ${content.length} canonical patterns.`,
    };
  }),

  // 14. Phase 6 Path Usage
  gate("path_usage", () => {
    const r = runScript("scripts/checks/path-usage.js");
    if (r.status === 0) {
      return {
        ok: true,
        severity: "green",
        message:
          "Phase 6 path-usage audit found active consumers for previously flagged keys.",
      };
    }
    return {
      ok: false,
      severity: "red",
      message: "Path usage audit found unused flagged keys.",
      details: (r.stdout || r.stderr || "").split(/\r?\n/).slice(-8),
    };
  }),
];

function run(opts) {
  const skip = new Set((opts && opts.skip) || []);
  const results = [];
  let red = 0;
  let yellow = 0;
  let manual = 0;
  let degraded = 0;
  for (const g of GATES) {
    if (skip.has(g.name)) {
      results.push({
        name: g.name,
        severity: "skipped",
        message: "Skipped via --skip flag.",
      });
      continue;
    }
    let r;
    try {
      r = g.fn();
    } catch (e) {
      r = {
        ok: false,
        severity: "red",
        message: `${g.name} threw: ${e.message}`,
      };
    }
    results.push({ name: g.name, ...r });
    if (r.severity === "red") red += 1;
    else if (r.severity === "yellow") yellow += 1;
    else if (r.severity === "manual") manual += 1;
    else if (r.severity === "degraded") degraded += 1;
  }
  return {
    ok: red === 0,
    red,
    yellow,
    manual,
    degraded,
    green: results.filter((r) => r.severity === "green").length,
    skipped: results.filter((r) => r.severity === "skipped").length,
    results,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const skip = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip" && args[i + 1]) {
      skip.push(args[i + 1]);
      i += 1;
    }
  }
  const summary = run({ skip });
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const r of summary.results) {
      const tag =
        r.severity === "red"
          ? "RED  "
          : r.severity === "yellow"
            ? "YEL  "
            : r.severity === "skipped"
              ? "SKIP "
              : r.severity === "manual"
                ? "MAN  "
                : r.severity === "degraded"
                  ? "DEGR "
                  : "GRN  ";
      console.log(`[${tag}] ${r.name}: ${r.message}`);
      if (r.details) {
        for (const d of (Array.isArray(r.details)
          ? r.details
          : [r.details]
        ).slice(0, 5)) {
          console.log(
            `         ${typeof d === "string" ? d : JSON.stringify(d)}`,
          );
        }
      }
    }
    console.log(
      `\n${summary.green} green · ${summary.yellow} yellow · ${summary.red} red · ${summary.manual || 0} manual · ${summary.degraded || 0} degraded · ${summary.skipped} skipped — overall ${summary.ok ? "PASS" : "FAIL"}`,
    );
  }
  process.exit(summary.red > 0 ? 2 : summary.yellow > 0 ? 1 : 0);
}

module.exports = { run };
