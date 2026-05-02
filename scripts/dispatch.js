#!/usr/bin/env node
/**
 * dispatch.js — Dispatch Console CLI.
 *
 * The only way to view and edit agent dispatch config (provider/model/effort/
 * fallback). Writes to .claude/manifest.json and the matching
 * .claude/agents/**\/*.md frontmatter atomically with a backup ring.
 *
 * Subcommands:
 *   show                                          (default) print resolved config table
 *   edit <role>                                   interactive cascade wizard
 *   set <role> <provider> <model> [effort] [fb]   non-interactive set
 *   backups                                       list saved backups
 *   revert <backup-id>                            restore a backup
 *   help                                          usage
 */

"use strict";

const readline = require("node:readline");
const {
  PROVIDERS,
  PROVIDER_LIST,
  ROLES,
  validateTuple,
  getProvider,
  normalizeProviderId,
} = require("./dispatch/catalog");
const { renderCliPreview } = require("./dispatch/cli-preview");
const {
  requiresFallback,
  defaultFallback,
} = require("./dispatch/required-fallback");
const { buildPanelState } = require("./dispatch/state");
const { previewSave, applySave } = require("./dispatch/save");
const {
  listBackups,
  restoreBackup,
  createBackup,
} = require("./dispatch/backup");
const { getActiveRunStatus } = require("./dispatch/active-run");
const path = require("node:path");

// ── ANSI ───────────────────────────────────────────────────────
const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;
const c = NO_COLOR
  ? new Proxy({}, { get: () => (s) => s })
  : {
      reset: (s) => `\x1b[0m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[22m`,
      dim: (s) => `\x1b[2m${s}\x1b[22m`,
      red: (s) => `\x1b[31m${s}\x1b[39m`,
      green: (s) => `\x1b[32m${s}\x1b[39m`,
      yellow: (s) => `\x1b[33m${s}\x1b[39m`,
      blue: (s) => `\x1b[34m${s}\x1b[39m`,
      magenta: (s) => `\x1b[35m${s}\x1b[39m`,
      cyan: (s) => `\x1b[36m${s}\x1b[39m`,
      gray: (s) => `\x1b[90m${s}\x1b[39m`,
      bgGreen: (s) => `\x1b[42m\x1b[30m${s}\x1b[39m\x1b[49m`,
      bgRed: (s) => `\x1b[41m\x1b[37m${s}\x1b[39m\x1b[49m`,
    };

const PROVIDER_COLOR = {
  anthropic: c.cyan,
  openai: c.green,
  gemini: c.magenta,
};

// ── Helpers ────────────────────────────────────────────────────
function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function visibleLength(s) {
  // Strip ANSI for column-width math
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padVisible(s, n) {
  const len = visibleLength(s);
  if (len >= n) return s;
  return s + " ".repeat(n - len);
}

function header(title) {
  console.log("");
  console.log(c.bold(title));
  console.log(c.dim("─".repeat(Math.min(80, title.length + 8))));
}

// ── show ───────────────────────────────────────────────────────
function cmdShow() {
  const state = buildPanelState();
  const run = getActiveRunStatus();

  console.log("");
  console.log(c.bold("Dispatch Console"));
  if (run.isActive) {
    console.log(c.yellow(`⚠ ${run.reason}`));
  } else {
    console.log(c.dim(run.reason));
  }
  console.log("");

  const cols = ["role", "provider", "model", "effort", "fallback", "source"];
  const widths = [13, 11, 32, 7, 11, 28];

  const headerRow = cols.map((col, i) => c.dim(pad(col, widths[i]))).join(" ");
  console.log(headerRow);
  console.log(c.dim("─".repeat(widths.reduce((a, b) => a + b + 1, 0))));

  for (const r of state.roles) {
    const provColor = PROVIDER_COLOR[r.provider] || ((s) => s);
    const provCell = provColor(pad(r.provider, widths[1]));
    const modelCell = pad(r.model, widths[2]);
    const effortCell = pad(r.effort || "—", widths[3]);
    const fallbackCell = pad(r.fallback || "—", widths[4]);
    const sourceCell = pad(
      `p:${r.providerSource[0]} m:${r.modelSource[0]} e:${r.effortSource[0]}`,
      widths[5],
    );
    console.log(
      [
        pad(r.role, widths[0]),
        provCell,
        modelCell,
        effortCell,
        fallbackCell,
        c.dim(sourceCell),
      ].join(" "),
    );
    if (r.envShadows.length > 0) {
      for (const s of r.envShadows) {
        console.log(
          c.yellow(
            "  ⚠ " + `env shadow: ${s.var}=${s.value} overrides ${s.affects}`,
          ),
        );
      }
    }
  }

  console.log("");
  console.log(
    c.dim(
      "Source key: p=provider m=model e=effort · m/d/f = manifest/default/frontmatter, e=env",
    ),
  );
  console.log("");
  console.log(
    c.dim(
      "Commands: edit <role> · set <role> <prov> <model> [effort] [fb] · backups · revert <id> · help",
    ),
  );
}

// ── set (non-interactive) ──────────────────────────────────────
function cmdSet(argv) {
  const [roleArg, providerArg, model, effortArg, fallbackArg] = argv;
  if (!roleArg || !providerArg || !model) {
    console.error(
      c.red(
        "usage: dispatch.js set <role> <provider> <model> [effort] [fallback]",
      ),
    );
    process.exit(2);
  }
  const role = roleArg;
  const provider = normalizeProviderId(providerArg);
  if (!ROLES.includes(role)) {
    console.error(c.red(`unknown role: ${role}`));
    console.error(c.dim(`valid roles: ${ROLES.join(", ")}`));
    process.exit(2);
  }
  if (!getProvider(provider)) {
    console.error(c.red(`unknown provider: ${providerArg}`));
    console.error(
      c.dim(
        `valid providers: ${PROVIDER_LIST.map((p) => p.id).join(", ")} (aliases: anthropic, gpt, google)`,
      ),
    );
    process.exit(2);
  }
  const effort = effortArg && effortArg !== "" ? effortArg : null;
  const tupleErr = validateTuple(provider, model, effort);
  if (tupleErr) {
    console.error(c.red(tupleErr));
    process.exit(2);
  }
  const fallback =
    fallbackArg && fallbackArg !== ""
      ? normalizeProviderId(fallbackArg)
      : defaultFallback(provider);
  const input = { role, provider, model, effort, fallback };
  doSave(input, /* interactive */ false);
}

// ── edit (interactive cascade) ─────────────────────────────────
async function cmdEdit(argv) {
  const role = argv[0];
  if (!role) {
    console.error(c.red("usage: dispatch.js edit <role>"));
    process.exit(2);
  }
  if (!ROLES.includes(role)) {
    console.error(c.red(`unknown role: ${role}`));
    console.error(c.dim(`valid roles: ${ROLES.join(", ")}`));
    process.exit(2);
  }

  const state = buildPanelState();
  const cur = state.roles.find((r) => r.role === role);
  if (!cur) {
    console.error(c.red(`role ${role} not found in panel state`));
    process.exit(2);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

  console.log("");
  console.log(c.bold(`Editing role: ${role}`));
  console.log(
    c.dim(
      `  Current: ${cur.provider} / ${cur.model} / ${cur.effort || "—"} / fallback=${cur.fallback || "—"}`,
    ),
  );
  console.log("");

  // 1. Provider
  console.log(c.bold("Provider"));
  PROVIDER_LIST.forEach((p, i) => {
    const marker = p.id === cur.provider ? c.green("●") : " ";
    console.log(`  ${marker} ${i + 1}. ${p.label} (${p.id})`);
  });
  const provAns = await ask(
    `Select [1-${PROVIDER_LIST.length}] or id (Enter = keep ${cur.provider}): `,
  );
  let provider = cur.provider;
  if (provAns) {
    const idx = parseInt(provAns, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= PROVIDER_LIST.length) {
      provider = PROVIDER_LIST[idx - 1].id;
    } else if (PROVIDERS[normalizeProviderId(provAns)]) {
      provider = normalizeProviderId(provAns);
    } else if (PROVIDERS[provAns]) {
      provider = provAns;
    } else {
      rl.close();
      console.error(c.red(`invalid provider: ${provAns}`));
      process.exit(2);
    }
  }

  // 2. Model
  const provSpec = PROVIDERS[provider];
  console.log("");
  console.log(c.bold("Model"));
  provSpec.models.forEach((m, i) => {
    const marker = m.id === cur.model ? c.green("●") : " ";
    const tail = m.deprecated ? c.dim(" (deprecated)") : "";
    const effortBadge =
      m.effortLevels.length === 0
        ? c.dim(" (no effort param)")
        : c.dim(` [${m.effortLevels.join("|")}]`);
    console.log(`  ${marker} ${i + 1}. ${m.label}${tail}${effortBadge}`);
  });
  const defaultModelIdx =
    provSpec.models.findIndex((m) => m.id === provSpec.defaultModel) + 1;
  const modelAns = await ask(
    `Select [1-${provSpec.models.length}] or id (Enter = ${cur.provider === provider ? `keep ${cur.model}` : `default ${provSpec.defaultModel}`}): `,
  );
  let model =
    cur.provider === provider && !modelAns ? cur.model : provSpec.defaultModel;
  if (modelAns) {
    const idx = parseInt(modelAns, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= provSpec.models.length) {
      model = provSpec.models[idx - 1].id;
    } else if (provSpec.models.find((m) => m.id === modelAns)) {
      model = modelAns;
    } else {
      rl.close();
      console.error(c.red(`invalid model: ${modelAns}`));
      process.exit(2);
    }
  }
  void defaultModelIdx;

  // 3. Effort
  const modelSpec = provSpec.models.find((m) => m.id === model);
  let effort = null;
  if (modelSpec && modelSpec.effortLevels.length > 0) {
    console.log("");
    console.log(c.bold("Effort"));
    const opts = ["(none)", ...modelSpec.effortLevels];
    opts.forEach((e, i) => {
      const real = e === "(none)" ? null : e;
      const marker = real === cur.effort ? c.green("●") : " ";
      console.log(`  ${marker} ${i + 1}. ${e}`);
    });
    const effortAns = await ask(
      `Select [1-${opts.length}] or value (Enter = keep ${cur.effort || "(none)"}): `,
    );
    if (!effortAns) {
      effort =
        cur.provider === provider && cur.model === model ? cur.effort : null;
      // If keeping prior effort but it's no longer valid for this model, drop
      if (effort && !modelSpec.effortLevels.includes(effort)) effort = null;
    } else {
      const idx = parseInt(effortAns, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= opts.length) {
        effort = opts[idx - 1] === "(none)" ? null : opts[idx - 1];
      } else if (modelSpec.effortLevels.includes(effortAns)) {
        effort = effortAns;
      } else if (
        effortAns === "" ||
        effortAns === "(none)" ||
        effortAns === "none"
      ) {
        effort = null;
      } else {
        rl.close();
        console.error(c.red(`invalid effort: ${effortAns}`));
        process.exit(2);
      }
    }
  } else {
    console.log("");
    console.log(c.dim(`Effort: (no effort param for ${model})`));
  }

  // 4. Fallback
  let fallback = null;
  if (requiresFallback(provider)) {
    const opts = PROVIDER_LIST.filter((p) => p.id !== provider).map(
      (p) => p.id,
    );
    console.log("");
    console.log(c.bold("Fallback") + c.dim(" (required for non-anthropic)"));
    opts.forEach((f, i) => {
      const marker = f === cur.fallback ? c.green("●") : " ";
      console.log(`  ${marker} ${i + 1}. ${f}`);
    });
    const cur_fb_default =
      cur.fallback && opts.includes(cur.fallback) ? cur.fallback : "anthropic";
    const fbAns = await ask(
      `Select [1-${opts.length}] or id (Enter = ${cur_fb_default}): `,
    );
    if (!fbAns) fallback = cur_fb_default;
    else {
      const idx = parseInt(fbAns, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= opts.length)
        fallback = opts[idx - 1];
      else if (opts.includes(fbAns)) fallback = fbAns;
      else {
        rl.close();
        console.error(c.red(`invalid fallback: ${fbAns}`));
        process.exit(2);
      }
    }
  }

  rl.close();

  // Show preview
  const preview = renderCliPreview({ role, provider, model, effort });
  console.log("");
  console.log(c.bold("CLI invocation preview"));
  console.log(c.dim("  $ ") + preview.command);
  if (preview.effortIsNoOp) {
    console.log(c.yellow(`  ⚠ effort "${effort}" is a no-op for ${provider}`));
  }

  await confirmAndSave({ role, provider, model, effort, fallback });
}

// ── save (with diff confirmation) ──────────────────────────────
async function confirmAndSave(input) {
  const preview = previewSave(input);
  if (!preview.ok) {
    console.error(c.red(preview.error));
    process.exit(2);
  }
  if (preview.diffs.length === 0) {
    console.log("");
    console.log(c.dim("No changes — files already match."));
    return;
  }

  console.log("");
  console.log(
    c.bold(
      `${preview.diffs.length} file${preview.diffs.length === 1 ? "" : "s"} will change:`,
    ),
  );
  for (const d of preview.diffs) {
    console.log(
      `  ${d.path} ${c.green("+" + d.added)} ${c.red("-" + d.removed)}`,
    );
  }
  console.log("");

  // Render hunks
  for (const d of preview.diffs) {
    console.log(c.bold(`── ${d.path} ──`));
    for (const hunk of d.hunks) {
      console.log(c.dim(`  @@ hunk @@`));
      for (const ln of hunk) {
        const num = `${(ln.oldLine || "").toString().padStart(3)} ${(ln.newLine || "").toString().padStart(3)}`;
        if (ln.kind === "add") {
          console.log(c.green(`  ${num} + ${ln.text}`));
        } else if (ln.kind === "remove") {
          console.log(c.red(`  ${num} - ${ln.text}`));
        } else {
          console.log(c.dim(`  ${num}   ${ln.text}`));
        }
      }
    }
    console.log("");
  }

  await confirmAndApply(input);
}

async function confirmAndApply(input) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ans = await new Promise((res) =>
    rl.question(c.bold("Apply changes? [y/N] "), (a) =>
      res(a.trim().toLowerCase()),
    ),
  );
  rl.close();
  if (ans !== "y" && ans !== "yes") {
    console.log(c.dim("aborted, no changes written."));
    return;
  }
  doSave(input, /* interactive */ true);
}

function doSave(input, alreadyConfirmed) {
  if (!alreadyConfirmed) {
    // non-interactive set still validates and prints diff summary
    const prev = previewSave(input);
    if (!prev.ok) {
      console.error(c.red(prev.error));
      process.exit(2);
    }
    if (prev.diffs.length === 0) {
      console.log(c.dim("No changes — files already match."));
      return;
    }
    console.log(
      `${prev.diffs.length} file${prev.diffs.length === 1 ? "" : "s"} will change:`,
    );
    for (const d of prev.diffs) {
      console.log(`  ${d.path} +${d.added} -${d.removed}`);
    }
  }
  const result = applySave(input);
  if (!result.ok) {
    console.error(c.red(result.error));
    process.exit(1);
  }
  console.log("");
  console.log(c.green("✓ saved"));
  console.log(
    `  ${result.changedFiles.length} file${result.changedFiles.length === 1 ? "" : "s"} updated`,
  );
  if (result.backup) {
    console.log(c.dim(`  backup: ${result.backup.id}`));
    console.log(
      c.dim(`  revert: node scripts/dispatch.js revert ${result.backup.id}`),
    );
  }
}

// ── backups + revert ───────────────────────────────────────────
function cmdBackups() {
  const all = listBackups();
  console.log("");
  console.log(c.bold(`Backups (${all.length})`));
  if (all.length === 0) {
    console.log(c.dim("  (none yet)"));
    return;
  }
  for (const b of all) {
    console.log("");
    console.log(c.bold(b.id));
    console.log(`  ${b.summary}`);
    console.log(
      c.dim(
        `  ${b.changedFiles.length} file${b.changedFiles.length === 1 ? "" : "s"}${b.diffSummary ? " · " + b.diffSummary : ""}`,
      ),
    );
  }
  console.log("");
  console.log(c.dim("revert with: node scripts/dispatch.js revert <id>"));
}

function cmdRevert(argv) {
  const id = argv[0];
  if (!id) {
    console.error(c.red("usage: dispatch.js revert <backup-id>"));
    process.exit(2);
  }
  const target = listBackups().find((b) => b.id === id);
  if (!target) {
    console.error(c.red(`backup not found: ${id}`));
    process.exit(2);
  }

  // Pre-revert snapshot so the revert itself is reversible
  const PROJECT_ROOT = process.cwd();
  const absPaths = target.changedFiles.map((rel) =>
    path.join(PROJECT_ROOT, rel),
  );
  const preBackup = createBackup(absPaths, {
    summary: `pre-revert snapshot before restoring ${id}`,
  });
  console.log(c.dim(`pre-revert snapshot: ${preBackup.id}`));

  const { restored } = restoreBackup(id);
  console.log(
    c.green(
      `✓ reverted ${restored.length} file${restored.length === 1 ? "" : "s"}`,
    ),
  );
  for (const r of restored) console.log(c.dim(`  ${r}`));
}

// ── help ───────────────────────────────────────────────────────
function cmdHelp() {
  console.log(`
${c.bold("Dispatch Console")} — agent provider/model/effort manager

${c.bold("usage:")}  node scripts/dispatch.js <command> [args]
        npm run dispatch -- <command> [args]

${c.bold("commands:")}
  ${c.cyan("show")}                                    print resolved config table (default)
  ${c.cyan("gui")}  [--no-open]                        ephemeral local GUI in your browser (127.0.0.1 only)
  ${c.cyan("edit")} <role>                             interactive cascade wizard (terminal)
  ${c.cyan("set")}  <role> <provider> <model> [effort] [fallback]
                                          non-interactive set
  ${c.cyan("backups")}                                 list saved backups
  ${c.cyan("revert")} <backup-id>                      restore a backup
  ${c.cyan("help")}                                    show this message

${c.bold("examples:")}
  node scripts/dispatch.js
  node scripts/dispatch.js show
  node scripts/dispatch.js gui                              # opens browser at random port
  node scripts/dispatch.js edit reviewer
  node scripts/dispatch.js set reviewer openai gpt-5.5 xhigh claude
  node scripts/dispatch.js set builder claude claude-opus-4-7 max
  node scripts/dispatch.js backups
  node scripts/dispatch.js revert 2026-04-28T20-51-10-123Z

${c.bold("provider ids:")}  claude (alias: anthropic) · openai (alias: gpt) · gemini (alias: google)

${c.bold("on save:")}
  - .claude/manifest.json              (agentProviders block)
  - .claude/agents/**/*.md frontmatter (matching role's files)
  - .claude/agents/.system/dispatch-backups/<ts>/  (backup ring, last 50)

${c.bold("docs:")}
  docs/06-integrations/PROVIDER/             (model lists per provider)
  .claude/agents/.system/frontmatter-guide.md (frontmatter reference)
`);
}

// ── dispatch ────────────────────────────────────────────────────
async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd || "show") {
    case "show":
      cmdShow();
      break;
    case "edit":
      await cmdEdit(rest);
      break;
    case "set":
      cmdSet(rest);
      break;
    case "backups":
      cmdBackups();
      break;
    case "revert":
      cmdRevert(rest);
      break;
    case "gui": {
      const { startGui } = require("./dispatch/gui");
      const noOpen = rest.includes("--no-open");
      startGui({ openBrowser: !noOpen });
      // server keeps process alive; do not return
      return;
    }
    case "help":
    case "-h":
    case "--help":
      cmdHelp();
      break;
    default:
      console.error(c.red(`unknown command: ${cmd}`));
      cmdHelp();
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(c.red(e instanceof Error ? e.stack || e.message : String(e)));
  process.exit(1);
});
