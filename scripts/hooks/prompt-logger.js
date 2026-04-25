#!/usr/bin/env node
// UserPromptSubmit hook: logs each user message to centralized events log.

const { log } = require("./lib/logger");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const rawPrompt = event.prompt || event.tool_input?.prompt || "";

    // Strip system XML to extract actual user text
    const stripped = rawPrompt
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
      .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
      .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
      .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
      .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
      .trim();

    if (!stripped || stripped.length === 0) {
      process.exit(0);
      return;
    }

    // Detect plan-related responses
    const trimmed = stripped.trim();
    const isPlanResponse =
      /^(yes|no,|approve|reject|modify|change|instead|looks good|go ahead|do it|approved|rejected|lgtm|proceed|ship it|not yet)/i.test(
        trimmed,
      );
    const isPlanDiscussion =
      /\b(plan|approach|proposal|changes?|splash radius|your call|phase|mvp|roadmap)\b/i.test(
        trimmed,
      );

    // Log to centralized events log (full raw + stripped summary)
    log(
      "prompt",
      {
        raw: rawPrompt,
        stripped: stripped.replace(/\n/g, " ").slice(0, 500),
        length: rawPrompt.length,
        is_slash: stripped.startsWith("/"),
        is_plan_response: isPlanResponse,
        is_plan_discussion: isPlanDiscussion,
      },
      { actor: "user" },
    );

    process.exit(0);
  } catch {
    process.exit(0); // non-blocking
  }
});
