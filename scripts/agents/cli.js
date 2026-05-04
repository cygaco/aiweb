#!/usr/bin/env node
/**
 * scripts/agents/cli.js — Inspect the agent registry.
 *
 * Subcommands:
 *   list                       Enumerate all agent specs by mode + role.
 *   list --json                Same, JSON output.
 *   test <role>                Smoke-dispatch the role's provider with a ping.
 *   test --all                 Smoke-dispatch every non-claude role.
 *
 * Exit:
 *   0 — success
 *   1 — agent missing or test failed
 *   2 — usage error
 *
 * Empty-state behavior:
 *   list against an empty agents/ tree prints `no agents found at <path>` to stderr, exits 1.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function loadPaths() {
  try {
    return require("../hooks/lib/paths").PATHS;
  } catch {
    return { agents: ".claude/agents" };
  }
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        // skip hidden/system folders
        if (e.name.startsWith(".system") || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}

function readFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function listAgents(args) {
  const PATHS = loadPaths();
  const root = PATHS.agents || ".claude/agents";
  const files = walk(root);
  if (files.length === 0) {
    process.stderr.write(`no agents found at ${root}\n`);
    return 1;
  }
  const items = files.map((f) => {
    const fm = readFrontmatter(fs.readFileSync(f, "utf8"));
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    const stem = path.basename(f, ".md");
    return {
      role: fm.name || stem,
      path: rel,
      provider_model: fm.provider_model || null,
      description: fm.description || null,
    };
  });
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(`# ${items.length} agent(s)\n`);
  for (const it of items) {
    const tag = it.provider_model ? ` [${it.provider_model}]` : "";
    process.stdout.write(`  ${it.role}${tag}  ${it.path}\n`);
  }
  return 0;
}

function loadProviderForRole(role) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(".claude/manifest.json", "utf8"),
    );
    return (manifest.agentProviders || {})[role] || null;
  } catch {
    return null;
  }
}

function testRole(role) {
  const provider = loadProviderForRole(role);
  if (provider === "claude" || !provider) {
    process.stdout.write(
      `${role}: provider=claude — native dispatch (no test possible from CLI)\n`,
    );
    return 0;
  }
  const tmp = path.join(
    ".claude",
    "runtime",
    ".provider-tmp",
    `agents-test-${role}-${Date.now()}.txt`,
  );
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, "Reply with the single word PONG. Nothing else.");
  try {
    const out = execSync(`node scripts/dispatch-agent.js ${role} ${tmp}`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 90_000,
    }).toString();
    let parsed = {};
    try {
      parsed = JSON.parse(out);
    } catch {
      /* output not json */
    }
    if (parsed.ok) {
      process.stdout.write(
        `${role}: ok provider=${parsed.provider} model=${parsed.model || parsed.actualModel || "?"} reply=${(parsed.output || "").slice(0, 40)}\n`,
      );
      return 0;
    }
    process.stdout.write(
      `${role}: FAIL ${parsed.error || out.slice(0, 200)}\n`,
    );
    return 1;
  } catch (e) {
    process.stdout.write(`${role}: FAIL ${e.message}\n`);
    return 1;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* tmp cleanup best-effort */
    }
  }
}

function testCmd(args) {
  if (args.includes("--all")) {
    let manifest = {};
    try {
      manifest = JSON.parse(fs.readFileSync(".claude/manifest.json", "utf8"));
    } catch {
      process.stderr.write("manifest.json missing or unreadable\n");
      return 1;
    }
    const roles = Object.entries(manifest.agentProviders || {})
      .filter(([, p]) => p !== "claude")
      .map(([r]) => r);
    if (roles.length === 0) {
      process.stdout.write(
        "no non-claude roles in agentProviders — nothing to test\n",
      );
      return 0;
    }
    let failed = 0;
    for (const r of roles) {
      const code = testRole(r);
      if (code !== 0) failed++;
    }
    return failed > 0 ? 1 : 0;
  }
  const role = args[0];
  if (!role) {
    process.stderr.write("usage: agents test <role> | --all\n");
    return 2;
  }
  return testRole(role);
}

function main() {
  const [, , sub, ...rest] = process.argv;
  if (!sub) {
    process.stdout.write(
      "usage: node scripts/agents/cli.js <list|test> [args]\n",
    );
    process.exit(2);
  }
  if (sub === "list") process.exit(listAgents(rest));
  if (sub === "test") process.exit(testCmd(rest));
  process.stderr.write(`unknown subcommand: ${sub}\n`);
  process.exit(2);
}

if (require.main === module) main();

module.exports = { listAgents, testRole, walk };
