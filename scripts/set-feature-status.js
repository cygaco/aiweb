// Set a feature's status in store.json. Args: featureName status [note]
const fs = require("fs");
const { PATHS } = require("./hooks/lib/paths");

const [, , feature, status, ...noteParts] = process.argv;
const note = noteParts.join(" ") || null;

if (!feature || !status) {
  console.error(
    "Usage: node scripts/set-feature-status.js <feature> <status> [note]",
  );
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(PATHS.oneshotStore, "utf8"));
if (!store.features[feature]) {
  console.error(`Feature "${feature}" not found in store`);
  process.exit(1);
}

store.features[feature].status = status;
if (note) store.features[feature].note = note;
store.features[feature].builtAt = new Date().toISOString();

fs.writeFileSync(PATHS.oneshotStore, JSON.stringify(store, null, 2));
console.log(`${feature}.status = ${status}`);
