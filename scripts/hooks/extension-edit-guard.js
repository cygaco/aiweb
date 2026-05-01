#!/usr/bin/env node
// PreToolUse hook: advisory CSP/CSRF/permissions reminder when editing the
// browser extension's manifest or background script. Implements LRN-2026-04-01/02
// (extension lifecycle + manifest security) — see BACKLOG.md item #3.
//
// Advisory only — never blocks. The reminders surface load-bearing security
// concerns the editor should verify before saving.

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath } = require("./lib/paths");

const MANIFEST_REGEX = /(^|\/)extension\/manifest\.json$/;
const BACKGROUND_REGEX = /(^|\/)extension\/(background|content|config)\.js$/;
const POPUP_REGEX = /(^|\/)extension\/popup\.(html|js|css)$/;

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";
    if (!/^(Edit|Write)$/.test(toolName)) process.exit(0);

    const toolInput = event.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || "";
    if (!filePath) process.exit(0);

    const rel = relPath(filePath);
    const isManifest = MANIFEST_REGEX.test(rel);
    const isBackground = BACKGROUND_REGEX.test(rel);
    const isPopup = POPUP_REGEX.test(rel);

    if (!isManifest && !isBackground && !isPopup) process.exit(0);

    const reminders = [];

    if (isManifest) {
      reminders.push("manifest edit detected — verify:");
      reminders.push(
        "  • permissions[] grants only what the extension needs (least privilege)",
      );
      reminders.push(
        "  • host_permissions[] match the smallest URL pattern that works",
      );
      reminders.push(
        "  • externally_connectable.matches[] does not include wildcards or http://",
      );
      reminders.push(
        "  • content_scripts.matches[] do not target sensitive sites unintentionally",
      );
      reminders.push(
        "  • content_security_policy is set if extension fetches remote resources",
      );

      // Inspect actual manifest content to surface specific issues
      try {
        const abs = path.resolve(PROJECT, rel);
        const text =
          toolInput.content ||
          (fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "");
        if (text) {
          const manifest = JSON.parse(text);
          const ec = manifest.externally_connectable || {};
          const ecMatches = Array.isArray(ec.matches) ? ec.matches : [];
          if (ecMatches.some((m) => /^http:\/\//.test(m))) {
            reminders.push(
              "  ⚠ externally_connectable allows http:// — downgrade attacks possible",
            );
          }
          if (ecMatches.some((m) => m === "*://*/*" || m === "<all_urls>")) {
            reminders.push(
              "  ⚠ externally_connectable wildcards everything — narrow this",
            );
          }
          const hostPerms = manifest.host_permissions || [];
          if (hostPerms.includes("<all_urls>")) {
            reminders.push(
              "  ⚠ host_permissions includes <all_urls> — Chrome Web Store will flag this",
            );
          }
        }
      } catch {
        // Couldn't parse manifest yet (mid-edit) — skip content-aware checks
      }
    }

    if (isBackground) {
      reminders.push("background/content script edit detected — verify:");
      reminders.push(
        "  • postMessage / runtime.sendMessage targets are validated by sender origin",
      );
      reminders.push(
        "  • fetch() calls have explicit allow-list, not arbitrary URL inputs",
      );
      reminders.push(
        "  • storage.local data is sanitized before injection into pages",
      );
      reminders.push(
        "  • No eval(), Function(), innerHTML on untrusted strings",
      );
    }

    if (isPopup) {
      reminders.push("popup edit detected — verify:");
      reminders.push(
        "  • CSP restricts inline scripts (default MV3 is strict)",
      );
      reminders.push(
        "  • No remote resource fetches without manifest CSP allowlist",
      );
    }

    if (reminders.length) {
      process.stderr.write(`[extension-edit-guard] ${rel}\n`);
      for (const r of reminders) process.stderr.write(`  ${r}\n`);
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
