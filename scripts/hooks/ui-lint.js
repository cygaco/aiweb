#!/usr/bin/env node
// PostToolUse hook: non-blocking UI lint for .tsx files.
// Warns about design system violations. Exit 0 always (advisory, not blocking).

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || "";

    // Only check .tsx files in src/
    if (!filePath.endsWith(".tsx") || !filePath.includes("src/")) {
      process.exit(0);
    }

    const content =
      event.tool_input?.content || event.tool_input?.new_string || "";
    if (!content) {
      process.exit(0);
    }

    const warnings = [];

    // Check 1: Hardcoded hex colors in style objects (not in comments or string data)
    // Match hex colors that look like they're in style assignments, not imports/comments
    const hexPattern =
      /(?:color|background|border|fill|stroke|shadow)\s*[:=]\s*['"`]#[0-9a-fA-F]{3,8}['"`]/gi;
    const hexMatches = content.match(hexPattern);
    if (hexMatches) {
      warnings.push(
        `HARDCODED COLOR: Found ${hexMatches.length} hardcoded hex color(s). Use CSS custom properties (var(--primary), var(--error), etc.) instead. Matches: ${hexMatches.slice(0, 3).join(", ")}`,
      );
    }

    // Check 2: Raw HTML form elements (should use ui/ components)
    // Case-sensitive: <button is HTML, <Btn is our component
    const rawElements = [];
    if (/<button[\s>]/.test(content)) {
      rawElements.push("<button> — use <Btn> from src/components/ui/Btn");
    }
    if (/<input[\s/>]/.test(content)) {
      rawElements.push("<input> — use <Inp> from src/components/ui/Inp");
    }
    if (/<select[\s>]/.test(content)) {
      rawElements.push("<select> — use <Sel> from src/components/ui/Sel");
    }
    if (rawElements.length > 0) {
      warnings.push(
        `RAW HTML ELEMENTS: ${rawElements.join("; ")}. Use src/components/ui/ components for consistent styling and accessibility.`,
      );
    }

    // Check 3: JS-based hover (should use CSS :hover)
    if (/onMouseEnter|onMouseLeave/.test(content)) {
      // Only warn for new code, not existing ui/ components
      if (!filePath.includes("src/components/ui/")) {
        warnings.push(
          "JS HOVER: Using onMouseEnter/onMouseLeave for hover effects. Prefer CSS :hover for better performance and accessibility. See COMPONENT_LIBRARY.md known issues.",
        );
      }
    }

    // Check 4: Tailwind color utilities (project uses CSS vars, not Tailwind colors)
    const twColorPattern =
      /(?:text|bg|border|ring|fill|stroke)-(?:red|blue|green|yellow|purple|pink|indigo|gray|slate|zinc|neutral|stone|orange|amber|emerald|teal|cyan|sky|violet|fuchsia|rose|lime)-\d{2,3}/g;
    const twMatches = content.match(twColorPattern);
    if (twMatches) {
      warnings.push(
        `TAILWIND COLOR: Found Tailwind color utilities: ${twMatches.slice(0, 3).join(", ")}. Use CSS custom properties (var(--primary), etc.) instead.`,
      );
    }

    if (warnings.length > 0) {
      process.stderr.write(
        `\n⚠️  UI LINT (${filePath.split("/").pop()}):\n${warnings.map((w) => `  • ${w}`).join("\n")}\n`,
      );
    }

    process.exit(0);
  } catch (e) {
    // Fail open — never block on parse errors
    process.exit(0);
  }
});
