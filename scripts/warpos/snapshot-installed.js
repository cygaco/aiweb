#!/usr/bin/env node
/**
 * snapshot-installed.js - writes .claude/framework-installed.json for the
 * source repository itself without running the fresh installer over the tree.
 *
 * The installer writes this file for downstream projects. The WarpOS dev repo
 * also needs a snapshot so /warp:update can classify local assets against the
 * current baseline instead of treating every framework file as local-only.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_FILE = path.join(ROOT, ".claude", "framework-manifest.json");
const OUT_FILE = path.join(ROOT, ".claude", "framework-installed.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function flattenAssets(manifest) {
  const out = [];
  for (const [kind, assets] of Object.entries(manifest.assets || {})) {
    for (const asset of assets || []) out.push({ ...asset, kind: asset.kind || kind });
  }
  return out;
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function buildSnapshot() {
  const manifest = readJson(MANIFEST_FILE);
  const installedAssets = [];
  for (const asset of flattenAssets(manifest)) {
    const abs = path.join(ROOT, asset.dest || asset.src);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const hash = sha256File(abs);
    installedAssets.push({
      id: asset.id,
      kind: asset.kind,
      dest: asset.dest || asset.src,
      owner: asset.owner || "framework",
      mergeStrategy: asset.mergeStrategy || asset.merge || "replace_if_unmodified",
      installedHash: hash,
      currentHashAtInstall: hash,
      introducedIn: asset.introducedIn || manifest.version || "0.0.0",
    });
  }

  return {
    $schema: "warpos/framework-installed/v2",
    installedVersion: manifest.version,
    installedCommit: gitCommit(),
    installedAt: new Date().toISOString(),
    source: "self",
    target: ".",
    pathRegistryVersion: "v4",
    manifestSchema: manifest.$schema || "warpos/framework-manifest/v2",
    assets: installedAssets,
    generated: (manifest.generated_files || []).map((f) => f.dest),
  };
}

function main() {
  const check = process.argv.includes("--check");
  if (!fs.existsSync(MANIFEST_FILE)) {
    console.error("snapshot-installed: missing .claude/framework-manifest.json");
    process.exit(2);
  }
  const snapshot = buildSnapshot();
  const body = JSON.stringify(snapshot, null, 2) + "\n";

  if (check) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error("snapshot-installed: .claude/framework-installed.json missing");
      process.exit(1);
    }
    const existing = readJson(OUT_FILE);
    const ok =
      existing.$schema === "warpos/framework-installed/v2" &&
      existing.installedVersion === snapshot.installedVersion &&
      Array.isArray(existing.assets) &&
      existing.assets.length === snapshot.assets.length;
    if (!ok) {
      console.error("snapshot-installed: installed snapshot is stale or malformed");
      process.exit(1);
    }
    console.log(`snapshot-installed: ok (${existing.assets.length} assets)`);
    process.exit(0);
  }

  fs.writeFileSync(OUT_FILE, body, "utf8");
  console.log(`snapshot-installed: wrote .claude/framework-installed.json (${snapshot.assets.length} assets)`);
}

main();
