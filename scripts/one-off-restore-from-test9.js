// scripts/one-off-restore-from-test9.js
// Restore feature files from skeleton-test9 to undo a partial gut.
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const d = require(path.join(ROOT, ".gut-result.json"));

let ok = 0;
let fail = 0;
for (const g of d.gutted) {
  try {
    execSync(`git checkout skeleton-test9 -- "${g.rel}"`, {
      stdio: "pipe",
      cwd: ROOT,
    });
    ok++;
  } catch (e) {
    fail++;
    console.log("FAIL", g.rel, String(e.message).slice(0, 100));
  }
}
console.log(`restored: ${ok}, failed: ${fail}`);
