#!/usr/bin/env node
// Helper: classify a target install against a capsule and dump full decisions list.
// Usage: node scripts/warpos/list-decisions.js --target <path> --to <v> [--category C]

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function get(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

const target = path.resolve(get("--target"));
const to = get("--to");
const wantCategory = get("--category");
const source = path.resolve(
  get("--source") || path.resolve(__dirname, "..", ".."),
);

const update = require(path.join(__dirname, "update.js"));

// update.js doesn't export classify; replicate the inline classify call by
// reading the capsule + installed snapshot and walking the same logic.
const installedFile = path.join(target, ".claude", "framework-installed.json");
const installed = fs.existsSync(installedFile)
  ? JSON.parse(fs.readFileSync(installedFile, "utf8"))
  : null;

const capsuleDir = path.join(source, "framework", "releases", to);
const release = JSON.parse(
  fs.readFileSync(path.join(capsuleDir, "release.json"), "utf8"),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(capsuleDir, "framework-manifest.json"), "utf8"),
);
const capsule = { release, manifest };

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function sha256FileLfNormalized(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const out = Buffer.alloc(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && i + 1 < buf.length && buf[i + 1] === 0x0a) continue;
    out[j++] = buf[i];
  }
  return crypto.createHash("sha256").update(out.slice(0, j)).digest("hex");
}
function hashMatches(long, short) {
  if (!long || !short) return false;
  return long.startsWith(short);
}

const targetAssets = new Map();
for (const kind of Object.keys(manifest.assets || {})) {
  for (const a of manifest.assets[kind]) targetAssets.set(a.dest, a);
}
const installedAssets = new Map(
  (installed?.assets || []).map((a) => [a.dest, a]),
);
const decisions = [];

for (const [dest, asset] of targetAssets) {
  const localPath = path.join(target, dest);
  const installedRecord = installedAssets.get(dest);
  const localExists = fs.existsSync(localPath);
  const localSha = localExists ? sha256File(localPath) : null;
  const targetSha = asset.sha256 || null;
  let category = "UNKNOWN",
    reason = "";

  if (asset.owner === "generated") category = "GENERATED_REBUILD";
  else if (!localExists && !installedRecord) category = "ADD_SAFE";
  else if (!localExists && installedRecord) category = "DELETE_CONFLICT";
  else if (localExists && !installedRecord) category = "LOCAL_ONLY";
  else if (hashMatches(localSha, targetSha)) category = "UPDATE_SAFE";
  else if (
    targetSha &&
    hashMatches(sha256FileLfNormalized(localPath), targetSha)
  )
    category = "UPDATE_SAFE";
  else if (
    installedRecord &&
    hashMatches(localSha, installedRecord.installedHash)
  )
    category = "UPDATE_SAFE";
  else if (
    installedRecord?.installedHash &&
    hashMatches(
      sha256FileLfNormalized(localPath),
      installedRecord.installedHash,
    )
  )
    category = "UPDATE_SAFE";
  else {
    const ms =
      asset.mergeStrategy ||
      installedRecord?.mergeStrategy ||
      "replace_if_unmodified";
    if (ms === "regenerate") category = "GENERATED_REBUILD";
    else if (ms === "keep_local") category = "LOCAL_CUSTOMIZED";
    else category = "MERGE_CONFLICT";
  }
  decisions.push({ category, dest });
}

for (const [dest, rec] of installedAssets) {
  if (!targetAssets.has(dest)) {
    const localPath = path.join(target, dest);
    const localExists = fs.existsSync(localPath);
    const localSha = localExists ? sha256File(localPath) : null;
    let category = "DELETE_SAFE";
    if (!localExists) category = "DELETE_SAFE";
    else if (
      rec.installedHash &&
      !hashMatches(localSha, rec.installedHash) &&
      !hashMatches(sha256FileLfNormalized(localPath), rec.installedHash)
    )
      category = "DELETE_CONFLICT";
    decisions.push({ category, dest });
  }
}

let filtered = decisions;
if (wantCategory === "C")
  filtered = decisions.filter((d) =>
    ["MERGE_CONFLICT", "DELETE_CONFLICT"].includes(d.category),
  );
for (const d of filtered) console.log(`${d.category}\t${d.dest}`);
console.log(`# total: ${filtered.length}`);
