#!/usr/bin/env node
// PreToolUse hook: blocks Excalidraw tool calls.
// User works in terminal (CLI) — visual diagram tools don't render.
// Use ASCII art for flow diagrams instead.
// Implements learning #52 (terminal-only output).

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (toolName.startsWith("mcp__claude_ai_Excalidraw__")) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason:
            "BLOCKED: User works in terminal (CLI). Excalidraw diagrams don't render here. Use ASCII art for flow diagrams instead. See learning #52.",
        }),
      );
      process.exit(0);
    }

    // Not an Excalidraw tool — allow
    process.exit(0);
  } catch {
    // Fail-open on parse error
    process.exit(0);
  }
});
