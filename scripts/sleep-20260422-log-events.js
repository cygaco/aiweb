// Log sleep-cycle events using canonical logEvent/logLearning
const { logEvent } = require("./hooks/lib/logger.js");

logEvent("audit", "boss", {
  action: "sleep-cycle-start",
  ts: new Date().toISOString(),
  phase: "deep",
  session: "sleep-20260422",
});

logEvent("audit", "boss", {
  action: "learnings-consolidated",
  before: 174,
  after: 138,
  pruned: 36,
  importance_added: 126,
  phase: "NREM",
  session: "sleep-20260422",
});

console.log("Logged sleep-cycle-start + learnings-consolidated events");
