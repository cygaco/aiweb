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

    // Patterns that indicate leaked secrets
    const secretPatterns = [
      {
        pattern: /(?:sk|pk)-[a-zA-Z0-9_-]{20,}/,
        name: "API key (sk-/pk- prefix)",
      },
      {
        pattern: /ANTHROPIC_API_KEY\s*=\s*['"]?sk-/,
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
    ];

    for (const { pattern, name } of secretPatterns) {
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
