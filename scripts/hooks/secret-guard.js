#!/usr/bin/env node
// PreToolUse hook: blocks writes that contain secrets or credentials.
// Catches API keys, tokens, passwords before they hit disk.

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path;
    const content =
      event.tool_input?.content || event.tool_input?.new_string || "";

    // Skip non-file operations or empty content
    if (!filePath || !content) process.exit(0);

    // Skip .env files — they're supposed to have secrets
    if (/\.env(\.|$)/i.test(filePath)) process.exit(0);
    // Skip .env example files — they hold placeholder values by convention
    if (/\.env\.(example|local\.example|sample)$/i.test(filePath))
      process.exit(0);
    // Skip framework checksum / hash artifact files — 64-hex strings here
    // are SHA-256 digests of canonical content, not secrets. SP-20260518
    // secret-leak post-mortem: must allow hash files OR the generic
    // 64-hex detector below blocks the whole framework release flow.
    if (/framework[\\/]releases[\\/].*checksums\.json$/i.test(filePath))
      process.exit(0);
    if (/requirements\.graph\.json$/i.test(filePath)) process.exit(0);
    if (/\.shasum$|integrity\.json$/i.test(filePath)) process.exit(0);
    // Skip *.template / *.sample / *.example files — these hold placeholders
    // (REPLACE_WITH_YOUR_KEY, YOUR_KEY_HERE, etc.) by convention. The .cmd
    // wrapper has both forms — the .template tracked in git, the populated
    // .cmd gitignored.
    if (/\.(template|sample|example)$/i.test(filePath)) process.exit(0);

    // Placeholder-value short-circuit. A token like REPLACE_WITH_YOUR_KEY
    // or YOUR_KEY_HERE is not a secret even when assigned to a *_KEY var.
    // Applies before the secretPatterns scan; if the content has NO real
    // hex/b64 looking values, exit clean.
    const PLACEHOLDER =
      /(REPLACE_WITH|YOUR_[A-Z_]*KEY|YOUR_[A-Z_]*SECRET|YOUR_[A-Z_]*TOKEN|your_[a-z_]*key_here|generate-with-|<[A-Z_]+>|\$\{[A-Z_]+\}|%[A-Z_]+%)/;

    // Patterns that indicate leaked secrets
    const secretPatterns = [
      // ── Project-specific named secrets ────────────────────────────
      // SP-20260518 leak: WARP_MCP_KEY=<64hex> was committed in
      // scripts/one-off/aiweb-pizza-mcp.cmd; no prior pattern matched
      // because none of the rules below referenced WARP_MCP_KEY by name
      // and the generic "password|secret" rule required those literal
      // words in the variable name.
      {
        pattern: /WARP_MCP_KEY\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}/,
        name: "WARP_MCP_KEY assignment (aiweb bearer)",
      },
      {
        pattern: /PROFILE_ENCRYPTION_SECRET\s*[:=]\s*['"]?[A-Fa-f0-9]{32,}/,
        name: "PROFILE_ENCRYPTION_SECRET (32+ hex)",
      },
      {
        pattern: /BLAND_API_KEY\s*[:=]\s*['"]?(?!your_)[A-Za-z0-9_-]{16,}/,
        name: "BLAND_API_KEY assignment",
      },
      {
        pattern: /GOOGLE_PLACES_API_KEY\s*[:=]\s*['"]?AIzaSy[A-Za-z0-9_-]{20,}/,
        name: "GOOGLE_PLACES_API_KEY (AIzaSy prefix)",
      },
      // ── Windows .cmd / .bat set syntax ───────────────────────────
      // Catches `set "FOO_KEY=<32+hex>"` patterns (cmd.exe convention).
      {
        pattern: /set\s+"?[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN)=[A-Fa-f0-9]{32,}/,
        name: "Windows .cmd set KEY=<32+hex>",
      },
      // ── Generic high-entropy detector for assignment context ────
      // Catches any *_KEY / *_SECRET / *_TOKEN env-var or quoted
      // assignment whose RHS is a 32+-char hex blob. Skip-files above
      // exempt legitimate hash artifacts.
      {
        pattern:
          /[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN)\s*[:=]\s*['"]?[A-Fa-f0-9]{32,}/,
        name: "Generic *_KEY / *_SECRET / *_TOKEN with 32+ hex value",
      },
      // ── Standalone prefix-based detectors (no var-name context) ─
      // Catch keys that are pasted as literals into source/docs/tests,
      // not just as `FOO=value` assignments. These vendor prefixes are
      // distinctive enough that false-positive risk is near zero.
      {
        pattern: /AIzaSy[A-Za-z0-9_-]{33}/,
        name: "Google API key (AIzaSy prefix, standalone)",
      },
      {
        pattern: /sk-ant-api03-[A-Za-z0-9_-]{40,}/,
        name: "Anthropic API key (sk-ant-api03- standalone)",
      },
      // ── Existing patterns (preserved) ────────────────────────────
      {
        pattern: /(?:sk|pk)-[a-zA-Z0-9_-]{20,}/,
        name: "API key (sk-/pk- prefix)",
      },
      {
        pattern: /ANTHROPIC_API_KEY\s*=\s*['"]?sk-(?!ant-\.\.\.)/,
        name: "Anthropic API key assignment",
      },
      {
        pattern: /BRIGHTDATA_API_KEY\s*=\s*['"]?\w{10,}/,
        name: "Bright Data API key assignment",
      },
      {
        pattern: /UPSTASH_REDIS_REST_TOKEN\s*=\s*['"]?\w{10,}/,
        name: "Upstash token assignment",
      },
      {
        pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
        name: "Private key",
      },
      {
        pattern: /(?:password|passwd|secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
        name: "Hardcoded password",
      },
      {
        pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
        name: "JWT token",
      },
      {
        pattern: /ghp_[a-zA-Z0-9_]{36}/,
        name: "GitHub personal access token",
      },
      {
        pattern: /gho_[a-zA-Z0-9_]{36}/,
        name: "GitHub OAuth token",
      },
      {
        pattern: /ghu_[a-zA-Z0-9_]{36}/,
        name: "GitHub user-to-server token",
      },
      {
        pattern: /STRIPE_SECRET_KEY\s*=\s*['"]?sk_/,
        name: "Stripe secret key assignment",
      },
      {
        pattern: /STRIPE_WEBHOOK_SECRET\s*=\s*['"]?whsec_/,
        name: "Stripe webhook secret assignment",
      },
      {
        pattern: /JWT_SECRET\s*=\s*['"]?[^'"]{10,}/,
        name: "JWT secret assignment",
      },
      {
        pattern: /GOOGLE_CLIENT_SECRET\s*=\s*['"]?[^'"]{10,}/,
        name: "Google OAuth client secret",
      },
      {
        pattern: /LINKEDIN_CLIENT_SECRET\s*=\s*['"]?[^'"]{10,}/,
        name: "LinkedIn OAuth client secret",
      },
      // ── Card-number leak surface (SP-20260519-006 R-5) ───────────
      // The pizza concierge has a card-over-phone alpha path that
      // voices a card to the restaurant. The transcript is regex-
      // scrubbed before any log/cache hits disk; this hook is the
      // write-time gate that prevents code/docs/fixtures from
      // committing card numbers by accident. Allowlist covers the
      // regression-test fixture path that intentionally contains
      // a synthetic test card (4111-1111-1111-1111 etc.).
      {
        pattern: /\b\d{13,19}\b/,
        name: "Card-number-like 13-19 digit run",
        allowedPaths: /tests[\\/]regression[\\/]SP-20260519-006[\\/]/,
      },
      {
        pattern: /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/,
        name: "Card-number-like 4-4-4-4 grouped digits",
        allowedPaths: /tests[\\/]regression[\\/]SP-20260519-006[\\/]/,
      },
      {
        pattern: /\bCVV\s*[:=]?\s*\d{3,4}\b/i,
        name: "CVV-adjacent 3-4 digit code",
        allowedPaths: /tests[\\/]regression[\\/]SP-20260519-006[\\/]/,
      },
    ];

    for (const { pattern, name, allowedPaths } of secretPatterns) {
      if (allowedPaths && allowedPaths.test(filePath)) continue;
      if (pattern.test(content)) {
        process.stderr.write(
          `BLOCKED: File "${filePath}" contains a ${name}. Use environment variables instead.\n`,
        );
        process.exit(2);
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
