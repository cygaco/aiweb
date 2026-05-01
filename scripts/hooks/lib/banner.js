#!/usr/bin/env node
// Alex OS — Session banner with ANSI art
// Standalone utility for terminal display and image generation

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  b3: "\x1b[38;5;19m", // blue
  b5: "\x1b[38;5;32m", // teal blue
  b6: "\x1b[38;5;38m", // cyan-blue
  b7: "\x1b[38;5;44m", // cyan
  b8: "\x1b[38;5;50m", // bright cyan
  b9: "\x1b[38;5;51m", // electric cyan
  w: "\x1b[38;5;15m", // white
  g: "\x1b[38;5;240m", // gray
  gg: "\x1b[38;5;245m", // lighter gray
  acc: "\x1b[38;5;213m", // pink accent
  gold: "\x1b[38;5;220m", // gold
  grn: "\x1b[38;5;48m", // green
};

function renderBanner(info = {}) {
  const {
    branch = "?",
    uncommitted = 0,
    sessionId = "?",
    mode = "adhoc",
  } = info;

  const lines = [
    ``,
    `${c.b3}    ╔══════════════════════════════════════════════════════════════╗${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}      █████╗ ${c.b7} ██╗     ${c.b8} ███████╗${c.b9} ██╗  ██╗${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ██╔══██╗${c.b7} ██║     ${c.b8} ██╔════╝${c.b9} ╚██╗██╔╝${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ███████║${c.b7} ██║     ${c.b8} █████╗  ${c.b9}  ╚███╔╝ ${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ██╔══██║${c.b7} ██║     ${c.b8} ██╔══╝  ${c.b9}  ██╔██╗ ${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ██║  ██║${c.b7} ███████╗${c.b8} ███████╗${c.b9} ██╔╝ ██╗${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b6}     ╚═╝  ╚═╝${c.b7} ╚══════╝${c.b8} ╚══════╝${c.b9} ╚═╝  ╚═╝${c.w}                      ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}             ─── ${c.acc}${c.bold}Autonomous Learning Engine X${c.reset}${c.g} ───             ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  ┌────────────────────────────────────────────────────────┐  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  │${c.gg}  Session ${c.w}${c.bold}${sessionId.padEnd(12)}${c.reset}${c.g}  │${c.gg}  Branch ${c.grn}${c.bold}${branch.padEnd(22)}${c.reset}${c.g}│  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  │${c.gg}  Mode    ${c.gold}${c.bold}${mode.padEnd(12)}${c.reset}${c.g}  │${c.gg}  Files  ${c.w}${c.bold}${String(uncommitted).padEnd(22)}${c.reset}${c.g}│  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.g}  └────────────────────────────────────────────────────────┘  ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.dim}${c.gg}       α architect · β judgement · γ builder · δ runner       ${c.reset}${c.b3}║${c.reset}`,
    `${c.b3}    ║${c.b5}                                                              ${c.b3}║${c.reset}`,
    `${c.b3}    ╚══════════════════════════════════════════════════════════════╝${c.reset}`,
    ``,
  ];

  return lines.join("\n");
}

module.exports = { renderBanner };

// Allow standalone execution for testing
if (require.main === module) {
  process.stderr.write(
    renderBanner({
      branch: "skeleton-test7",
      uncommitted: 25,
      sessionId: "s-demo01",
      mode: "adhoc",
    }),
  );
}
