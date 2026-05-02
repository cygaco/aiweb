/**
 * gui.js — ephemeral local-only HTTP server for the dispatch panel GUI.
 *
 * Security boundary:
 *   - Bound to 127.0.0.1 explicitly. Any non-loopback connection (checked via
 *     req.socket.remoteAddress) is rejected with 403.
 *   - Random port chosen by the OS (we listen on port 0).
 *   - All routes are gated behind a 256-bit unguessable token in the URL path.
 *     Without the token, the server returns 404 for every path.
 *   - Server lifetime is bound to this CLI process. On SIGINT or stdin EOF or
 *     a /shutdown ping (the GUI tab pings it on `beforeunload`), the server
 *     and process exit cleanly.
 *   - There is NO persistent route, NO middleware on the public Next.js app,
 *     and NO listener on a public interface. This is structurally equivalent
 *     to Chrome DevTools' debugger backend, not a Next.js admin route.
 *
 * No external deps; uses only Node's built-in http + crypto + child_process.
 */

"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { PROVIDER_LIST, ROLES } = require("./catalog");
const { buildPanelState } = require("./state");
const { previewSave, applySave } = require("./save");
const { listBackups, restoreBackup, createBackup } = require("./backup");
const { getActiveRunStatus } = require("./active-run");
const path = require("node:path");

const PROJECT_ROOT = process.cwd();

// ── Loopback enforcement ───────────────────────────────────────
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress;
  return !!a && LOOPBACK_ADDRS.has(a);
}

// ── Browser auto-open ─────────────────────────────────────────
function openInBrowser(url) {
  try {
    if (process.platform === "win32") {
      // The empty "" is a title arg required by Windows `start`
      spawn("cmd", ["/c", "start", '""', url], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Browser open failed — caller already printed the URL, user can paste it
  }
}

// ── Helpers ────────────────────────────────────────────────────
function send(res, status, body, type) {
  res.writeHead(status, {
    "content-type": type || "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error("payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// ── HTTP server ────────────────────────────────────────────────
function buildHandler(token, signalShutdown, lifecycle) {
  const prefix = `/${token}`;
  return async function handler(req, res) {
    if (!isLoopback(req)) {
      res.statusCode = 403;
      return res.end();
    }
    if (!req.url || !req.url.startsWith(prefix)) {
      res.statusCode = 404;
      return res.end();
    }
    // Any valid (token-bearing) request cancels a pending soft-shutdown — this
    // is what lets a page reload reconnect within the grace window instead of
    // killing the server.
    lifecycle.cancelPendingShutdown();
    const subPath = req.url.slice(prefix.length) || "/";
    try {
      // GET / → HTML
      if ((subPath === "/" || subPath === "") && req.method === "GET") {
        return send(res, 200, renderHtml(token), "text/html; charset=utf-8");
      }
      if (subPath === "/api/state" && req.method === "GET") {
        const state = buildPanelState();
        const activeRun = getActiveRunStatus();
        return send(res, 200, {
          state,
          catalog: { providers: PROVIDER_LIST, roles: ROLES },
          activeRun,
        });
      }
      if (subPath === "/api/preview" && req.method === "POST") {
        const body = await readJson(req);
        const result = previewSave(body.input || {});
        if (!result.ok) return send(res, 400, { error: result.error });
        return send(res, 200, {
          ok: true,
          diffs: result.diffs,
          changedFiles: result.changedFiles,
        });
      }
      if (subPath === "/api/save" && req.method === "POST") {
        const body = await readJson(req);
        const result = applySave(body.input || {});
        if (!result.ok) return send(res, 400, { error: result.error });
        return send(res, 200, result);
      }
      if (subPath === "/api/backups" && req.method === "GET") {
        return send(res, 200, { backups: listBackups() });
      }
      if (subPath === "/api/revert" && req.method === "POST") {
        const body = await readJson(req);
        const id = body.id;
        if (!id) return send(res, 400, { error: "missing id" });
        const target = listBackups().find((b) => b.id === id);
        if (!target) return send(res, 404, { error: "backup not found" });
        const absPaths = target.changedFiles.map((rel) =>
          path.join(PROJECT_ROOT, rel),
        );
        const preBackup = createBackup(absPaths, {
          summary: `pre-revert snapshot before restoring ${id}`,
        });
        const { restored } = restoreBackup(id);
        return send(res, 200, {
          ok: true,
          restored,
          restoredFromBackup: id,
          preRevertBackupId: preBackup.id,
        });
      }
      if (subPath === "/api/shutdown" && req.method === "POST") {
        send(res, 200, { ok: true });
        // Soft shutdown: schedule exit, but cancel if a new request arrives
        // first (e.g. from a page reload). Refresh stays alive; close exits.
        lifecycle.scheduleShutdown(3000, "client closed");
        return;
      }
      if (subPath === "/api/health" && req.method === "GET") {
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

// ── HTML / CSS / JS payload (vanilla, no deps) ─────────────────
function renderHtml(token) {
  // Token is embedded so the page can call its own /api/* endpoints.
  // It's already in the URL the user opened; this just lets the JS read it
  // without parsing window.location each time.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dispatch Console</title>
  <style>
    :root {
      --bg: #0b0303;
      --surface: #141010;
      --surface-alt: #1e1818;
      --text: #f0eded;
      --text-muted: #9a9494;
      --primary: #ff5a17;
      --primary-hover: #e64e12;
      --primary-soft: rgba(255, 90, 23, 0.1);
      --border: #2a2424;
      --border-focus: #ff5a17;
      --success: #acd229;
      --success-light: rgba(172, 210, 41, 0.1);
      --success-border: rgba(172, 210, 41, 0.3);
      --warning: #eab308;
      --warning-light: rgba(234, 179, 8, 0.1);
      --warning-border: rgba(234, 179, 8, 0.3);
      --error: #ef4444;
      --error-light: rgba(239, 68, 68, 0.1);
      --error-border: rgba(239, 68, 68, 0.3);
      --info: #d4a054;
      --radius: 4px;
      --radius-lg: 8px;
      --radius-full: 9999px;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.4);
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --space-6: 24px;
      --space-7: 32px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Inter", system-ui, sans-serif;
      font-size: 14px;
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: var(--space-6) var(--space-5);
    }
    h1 { font-size: 28px; margin: 0; font-weight: 600; }
    h2 { font-size: 18px; margin: 0 0 var(--space-3); font-weight: 600; }
    .subtitle { color: var(--text-muted); margin: var(--space-2) 0 0; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    a { color: var(--primary); }

    .header {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: var(--space-3); flex-wrap: wrap;
      margin-bottom: var(--space-6);
    }
    .nav { display: flex; gap: var(--space-3); font-size: 13px; color: var(--text-muted); }

    .banner {
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius);
      margin-bottom: var(--space-4);
      font-size: 13px;
    }
    .banner.info { background: rgba(212,160,84,0.08); border: 1px solid rgba(212,160,84,0.25); color: var(--info); }
    .banner.warn { background: var(--warning-light); border: 1px solid var(--warning-border); color: var(--warning); }
    .banner.error { background: var(--error-light); border: 1px solid var(--error-border); color: var(--error); }
    .banner.success { background: var(--success-light); border: 1px solid var(--success-border); color: var(--success); }

    .row {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
      margin-bottom: var(--space-3);
    }
    .row.dirty { border-color: var(--primary); }
    .row-head {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: var(--space-3); margin-bottom: var(--space-3); flex-wrap: wrap;
    }
    .role-name { font-weight: 600; font-size: 17px; }
    .role-files {
      font-size: 11px; color: var(--text-muted); margin-top: 2px;
      font-family: ui-monospace, monospace;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(220px, 2fr) minmax(140px, 1fr) minmax(180px, 1fr);
      gap: var(--space-3);
      align-items: end;
    }
    .field label {
      display: block; font-size: 12px; font-weight: 500; color: var(--text-muted);
      margin-bottom: 4px;
    }
    .field select {
      width: 100%; background: var(--surface-alt); color: var(--text);
      border: 1px solid var(--border); border-radius: var(--radius);
      padding: 8px 12px; font-size: 14px;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239a9494' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px;
    }
    .field select:focus { border-color: var(--border-focus); outline: none; }
    .field select:disabled { opacity: 0.5; cursor: not-allowed; }

    .row-foot {
      display: flex; gap: var(--space-2); justify-content: flex-end;
      align-items: center; margin-top: var(--space-3);
    }
    .row-foot .source {
      flex: 1; font-size: 11px; color: var(--text-muted);
    }
    button {
      font-family: inherit; font-size: 13px; padding: 8px 16px;
      border-radius: var(--radius); border: none; cursor: pointer;
      transition: background 0.15s;
    }
    button.primary { background: var(--primary); color: #fff; }
    button.primary:hover:not(:disabled) { background: var(--primary-hover); }
    button.ghost { background: transparent; color: var(--text-muted); }
    button.ghost:hover:not(:disabled) { color: var(--text); }
    button.secondary { background: transparent; color: var(--primary); border: 1px solid var(--primary); }
    button.secondary:hover:not(:disabled) { background: var(--primary-soft); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    .preview {
      margin-top: var(--space-3);
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: var(--space-3);
      font-size: 12px;
      font-family: ui-monospace, monospace;
    }
    .preview .label {
      color: var(--text-muted); font-family: "Inter", sans-serif;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
      margin-bottom: var(--space-2);
    }
    .preview code { display: block; word-break: break-all; white-space: pre-wrap; }
    .preview details { margin-top: var(--space-2); }
    .preview summary { color: var(--text-muted); cursor: pointer; font-family: inherit; font-size: 11px; }
    .flag-row { display: flex; gap: var(--space-3); padding: 2px 0; font-size: 11px; }
    .flag-row code { color: var(--primary); min-width: 220px; display: inline-block; }
    .flag-row span { color: var(--text-muted); }

    .chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .chip-warn {
      background: var(--warning-light); color: var(--warning);
      border: 1px solid var(--warning-border);
      font-size: 11px; padding: 3px 8px; border-radius: var(--radius-full);
    }

    .modal {
      position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100;
      display: flex; align-items: center; justify-content: center; padding: var(--space-5);
    }
    .modal-body {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius-lg); max-width: 1100px; width: 100%; max-height: 85vh;
      display: flex; flex-direction: column; box-shadow: var(--shadow-lg);
    }
    .modal-head {
      padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center;
    }
    .modal-content { display: flex; flex: 1; min-height: 0; }
    .modal-side {
      width: 320px; border-right: 1px solid var(--border);
      overflow-y: auto; padding: var(--space-3);
    }
    .modal-main {
      flex: 1; overflow-y: auto; padding: var(--space-4);
      font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5;
    }
    .modal-foot {
      padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border);
      display: flex; justify-content: flex-end; gap: var(--space-3);
    }
    .file-pill {
      display: block; width: 100%; text-align: left;
      padding: var(--space-2) var(--space-3); background: transparent;
      border: 1px solid transparent; border-radius: var(--radius);
      color: var(--text); cursor: pointer; margin-bottom: var(--space-1);
      font-family: ui-monospace, monospace; font-size: 12px;
    }
    .file-pill.active { background: var(--primary-soft); border-color: var(--primary); }
    .file-pill .stats { font-size: 11px; margin-top: 2px; }
    .file-pill .add { color: var(--success); }
    .file-pill .rem { color: var(--error); }

    .hunk-head { color: var(--text-muted); font-size: 11px;
      margin-bottom: var(--space-1); font-family: "Inter", sans-serif; }
    .diff-line { padding: 1px var(--space-2); display: flex; gap: var(--space-3); }
    .diff-line .gutter { color: var(--text-muted); min-width: 90px; font-size: 11px; }
    .diff-line .text { white-space: pre-wrap; word-break: break-all; }
    .diff-line.add { background: rgba(172, 210, 41, 0.1); }
    .diff-line.add .text { color: var(--success); }
    .diff-line.rem { background: rgba(239, 68, 68, 0.1); }
    .diff-line.rem .text { color: var(--error); }
    .diff-line.ctx .text { color: var(--text-muted); }

    .backup-card {
      padding: var(--space-3); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: var(--space-2);
      display: flex; justify-content: space-between; gap: var(--space-3);
      align-items: center; flex-wrap: wrap;
    }
    .backup-id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--text-muted); }
    .backup-summary { margin-top: 2px; font-size: 13px; }
    .backup-meta { margin-top: 2px; font-size: 11px; color: var(--text-muted); font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
<main>
  <header class="header">
    <div>
      <h1>Dispatch Console</h1>
      <p class="subtitle">
        Configure provider, model, and effort per agent role. Saves write to
        <code>.claude/manifest.json</code> and the matching
        <code>.claude/agents/**/*.md</code> frontmatter. Backups taken automatically.
      </p>
      <p class="subtitle" style="font-size: 12px; margin-top: var(--space-2);">
        🔒 Local-only · 127.0.0.1 · ephemeral · this server dies when you close the tab or stop the CLI
      </p>
    </div>
    <nav class="nav">
      <a href="#" onclick="loadAll();return false" style="color:var(--primary)">Refresh</a>
      <a href="https://github.com" onclick="return false" data-doc="provider">Provider docs</a>
      <a href="https://github.com" onclick="return false" data-doc="frontmatter">Frontmatter guide</a>
    </nav>
  </header>

  <div id="flash-container"></div>
  <div id="root">Loading…</div>
</main>

<script>
const TOKEN = ${JSON.stringify(token)};
const BASE = "/" + TOKEN;
const PROVIDER_COLORS = { claude: "#7dd3fc", openai: "#86efac", gemini: "#d8b4fe" };

// ── State ──────────────────────────────────────────────────────
let panel = null;     // { state, catalog, activeRun }
let drafts = {};      // role -> { provider, model, effort, fallback }
let backups = [];
let pendingDiff = null; // { role, diffs, input }
let busy = false;

// ── Helpers ────────────────────────────────────────────────────
async function api(path, init) {
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    throw new Error(body.error || (res.status + " " + res.statusText));
  }
  return res.json();
}

function isDirty(state, draft) {
  return draft.provider !== state.provider
      || draft.model !== state.model
      || draft.effort !== state.effort
      || draft.fallback !== state.fallback;
}

function requiresFallback(prov) { return prov !== "claude"; }

function findProvider(id) {
  return panel.catalog.providers.find(p => p.id === id);
}

function findModel(provId, modelId) {
  const p = findProvider(provId);
  return p ? p.models.find(m => m.id === modelId) : null;
}

function defaultDraftFor(state) {
  return { provider: state.provider, model: state.model, effort: state.effort, fallback: state.fallback };
}

// ── Cascade handlers ───────────────────────────────────────────
function onProviderChange(role, value) {
  const prov = findProvider(value);
  drafts[role] = {
    provider: value,
    model: prov.defaultModel,
    effort: (findModel(value, prov.defaultModel).effortLevels[0]) || null,
    fallback: requiresFallback(value) ? "claude" : null,
  };
  render();
}

function onModelChange(role, value) {
  const d = drafts[role];
  const m = findModel(d.provider, value);
  const newEffort = m && m.effortLevels.includes(d.effort) ? d.effort : (m && m.effortLevels[0]) || null;
  drafts[role] = { ...d, model: value, effort: newEffort };
  render();
}

function onEffortChange(role, value) {
  drafts[role] = { ...drafts[role], effort: value === "" ? null : value };
  render();
}

function onFallbackChange(role, value) {
  drafts[role] = { ...drafts[role], fallback: value === "" ? null : value };
  render();
}

function onReset(role) {
  const s = panel.state.roles.find(r => r.role === role);
  drafts[role] = defaultDraftFor(s);
  render();
}

async function onSave(role) {
  const d = drafts[role];
  busy = true; render();
  try {
    const preview = await api("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { role, ...d } }),
    });
    if (!preview.diffs || preview.diffs.length === 0) {
      flash("No changes — files already match.", "info");
      busy = false; render(); return;
    }
    pendingDiff = { role, diffs: preview.diffs, input: { role, ...d } };
  } catch (e) {
    flash(e.message, "error");
  } finally {
    busy = false; render();
  }
}

async function confirmSave() {
  if (!pendingDiff) return;
  busy = true; render();
  try {
    const result = await api("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: pendingDiff.input }),
    });
    flash("Saved · " + result.changedFiles.length + " file(s) · backup " + (result.backup && result.backup.id), "success");
    pendingDiff = null;
    await loadAll();
  } catch (e) {
    flash(e.message, "error");
  } finally {
    busy = false; render();
  }
}

function cancelDiff() { pendingDiff = null; render(); }

async function onRevert(id) {
  if (!confirm("Revert backup " + id + "? A pre-revert snapshot will also be saved.")) return;
  busy = true; render();
  try {
    const result = await api("/api/revert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    flash("Reverted " + result.restored.length + " file(s)", "success");
    await loadAll();
  } catch (e) {
    flash(e.message, "error");
  } finally {
    busy = false; render();
  }
}

// ── Status flash ───────────────────────────────────────────────
// Lives in #flash-container OUTSIDE #root, so render() rebuilds don't wipe it.
let flashTimer = null;
function flash(msg, kind) {
  const el = document.getElementById("flash-container");
  if (!el) return;
  el.innerHTML = '<div class="banner ' + kind + '">' + escapeHtml(msg) + '</div>';
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    const cur = document.getElementById("flash-container");
    if (cur) cur.innerHTML = "";
  }, kind === "success" ? 6000 : 4000);
}

// ── Render ─────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderRow(state) {
  const draft = drafts[state.role] || defaultDraftFor(state);
  const dirty = isDirty(state, draft);
  const prov = findProvider(draft.provider);
  const model = findModel(draft.provider, draft.model);
  const effortDisabled = !model || model.effortLevels.length === 0;
  const fallbackReq = requiresFallback(draft.provider);
  const fallbackOpts = panel.catalog.providers.filter(p => p.id !== draft.provider).map(p => p.id);

  const providerOpts = panel.catalog.providers.map(p =>
    \`<option value="\${p.id}" \${p.id === draft.provider ? "selected" : ""}>\${escapeHtml(p.label)}</option>\`
  ).join("");

  const modelOpts = prov.models.map(m =>
    \`<option value="\${m.id}" \${m.id === draft.model ? "selected" : ""}>\${escapeHtml(m.label)}\${m.deprecated ? " (deprecated)" : ""}</option>\`
  ).join("");

  let effortOpts = "";
  if (effortDisabled) {
    effortOpts = '<option value="">(no effort param)</option>';
  } else {
    effortOpts = '<option value="">(none)</option>' +
      model.effortLevels.map(e =>
        \`<option value="\${e}" \${e === draft.effort ? "selected" : ""}>\${e}</option>\`
      ).join("");
  }

  const fallbackOptsHtml =
    (fallbackReq ? "" : '<option value="">(none)</option>') +
    fallbackOpts.map(f =>
      \`<option value="\${f}" \${f === draft.fallback ? "selected" : ""}>\${escapeHtml(f)}</option>\`
    ).join("");

  // Compute CLI preview (mirror cli-preview.js logic)
  let cmd = prov.syntaxTemplate
    .replace("{reasoning}", draft.effort ? prov.cliEffortFlagTemplate.replace("{effort}", draft.effort) : "")
    .replace("{model}", draft.model)
    .replace("{role}", state.role)
    .replace(/\\s+/g, " ").trim();
  const effortIsNoOp = !!draft.effort && prov.cliEffortFlagTemplate === "";

  const envChips = (state.envShadows || []).map(s =>
    \`<span class="chip-warn" title="\${escapeHtml(s.var)}=\${escapeHtml(s.value)} overrides \${s.affects}">env shadow: \${escapeHtml(s.var)}</span>\`
  ).join("");

  return \`
    <div class="row \${dirty ? "dirty" : ""}">
      <div class="row-head">
        <div>
          <div class="role-name">\${escapeHtml(state.role)}</div>
          <div class="role-files">\${state.files.length === 0 ? "no agent files" : state.files.length + " file(s) · " + state.files.map(escapeHtml).join(", ")}</div>
        </div>
        <div class="chips">\${envChips}</div>
      </div>
      <div class="grid">
        <div class="field">
          <label>Provider</label>
          <select onchange="onProviderChange('\${state.role}', this.value)">\${providerOpts}</select>
        </div>
        <div class="field">
          <label>Model</label>
          <select onchange="onModelChange('\${state.role}', this.value)">\${modelOpts}</select>
        </div>
        <div class="field">
          <label>Effort</label>
          <select onchange="onEffortChange('\${state.role}', this.value)" \${effortDisabled ? "disabled" : ""}>\${effortOpts}</select>
        </div>
        <div class="field">
          <label>Fallback \${fallbackReq ? "(required)" : "(optional)"}</label>
          <select onchange="onFallbackChange('\${state.role}', this.value)" \${fallbackReq && draft.fallback ? "data-locked='1'" : ""}>\${fallbackOptsHtml}</select>
          \${fallbackReq ? '<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">Locked: required when provider isn\\'t Claude</div>' : ''}
        </div>
      </div>
      <div class="preview">
        <div class="label">CLI invocation (read-only)</div>
        <code>$ \${escapeHtml(cmd)}</code>
        \${effortIsNoOp ? \`<div style="margin-top:var(--space-2);color:var(--warning);font-family:Inter,sans-serif;font-size:11px">⚠ effort "\${escapeHtml(draft.effort)}" is a no-op for \${draft.provider} — thinking is implicit on this tier</div>\` : ""}
      </div>
      <div class="row-foot">
        <span class="source">source: provider=\${state.providerSource} · model=\${state.modelSource} · effort=\${state.effortSource}</span>
        <button class="ghost" onclick="onReset('\${state.role}')" \${!dirty || busy ? "disabled" : ""}>Reset</button>
        <button class="primary" onclick="onSave('\${state.role}')" \${!dirty || busy ? "disabled" : ""}>Save</button>
      </div>
    </div>
  \`;
}

function renderActiveRun() {
  if (!panel.activeRun) return "";
  if (panel.activeRun.isActive) {
    return \`<div class="banner warn"><strong>Run #\${panel.activeRun.runNumber} (\${panel.activeRun.skeletonBranch}) is in progress.</strong> Saving now will affect the next dispatch in this run. Backups are taken automatically.</div>\`;
  }
  return \`<div class="banner info"><strong>No active oneshot run.</strong> <span style="color:var(--text-muted)">\${escapeHtml(panel.activeRun.reason)}</span></div>\`;
}

function renderBackups() {
  if (backups.length === 0) {
    return '<div style="color:var(--text-muted);font-size:13px">No backups yet — saves will appear here.</div>';
  }
  return backups.map(b => \`
    <div class="backup-card">
      <div style="flex:1;min-width:0">
        <div class="backup-id">\${escapeHtml(b.id)}</div>
        <div class="backup-summary">\${escapeHtml(b.summary)}</div>
        <div class="backup-meta" title="\${escapeHtml(b.changedFiles.join("\\n"))}">\${b.changedFiles.length} file(s)\${b.diffSummary ? " · " + escapeHtml(b.diffSummary) : ""}</div>
      </div>
      <button class="secondary" onclick="onRevert('\${escapeHtml(b.id)}')" \${busy ? "disabled" : ""}>Revert</button>
    </div>
  \`).join("");
}

function renderDiffModal() {
  if (!pendingDiff) return "";
  const activeIdx = window._activeDiffIdx || 0;
  const active = pendingDiff.diffs[activeIdx];
  const list = pendingDiff.diffs.map((d, i) => \`
    <button class="file-pill \${i === activeIdx ? "active" : ""}" onclick="setActiveDiff(\${i})" title="\${escapeHtml(d.path)}">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${escapeHtml(d.path)}</div>
      <div class="stats"><span class="add">+\${d.added}</span> <span class="rem">-\${d.removed}</span></div>
    </button>
  \`).join("");

  const hunks = active.hunks.map((hunk, hi) => \`
    <div style="margin-bottom:var(--space-4)">
      <div class="hunk-head">Hunk \${hi + 1}</div>
      \${hunk.map(line => {
        const oldL = line.oldLine == null ? "" : String(line.oldLine).padStart(3, " ");
        const newL = line.newLine == null ? "" : String(line.newLine).padStart(3, " ");
        const prefix = line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  ";
        const cls = line.kind === "add" ? "add" : line.kind === "remove" ? "rem" : "ctx";
        return \`<div class="diff-line \${cls}"><span class="gutter">\${oldL} \${newL}</span><span class="text">\${prefix}\${escapeHtml(line.text)}</span></div>\`;
      }).join("")}
    </div>
  \`).join("");

  return \`
    <div class="modal" onclick="cancelDiff()">
      <div class="modal-body" onclick="event.stopPropagation()">
        <div class="modal-head">
          <div>
            <div style="font-weight:600;font-size:18px">Review changes</div>
            <div style="font-size:13px;color:var(--text-muted)">\${pendingDiff.diffs.length} file(s) will change</div>
          </div>
          <button class="ghost" onclick="cancelDiff()">Close</button>
        </div>
        <div class="modal-content">
          <aside class="modal-side">\${list}</aside>
          <main class="modal-main">
            <div style="color:var(--text-muted);margin-bottom:var(--space-3);font-family:Inter,sans-serif;font-size:13px">\${escapeHtml(active.path)}</div>
            \${hunks}
          </main>
        </div>
        <div class="modal-foot">
          <button class="ghost" onclick="cancelDiff()" \${busy ? "disabled" : ""}>Cancel</button>
          <button class="primary" onclick="confirmSave()" \${busy ? "disabled" : ""}>Confirm save (\${pendingDiff.diffs.length} files)</button>
        </div>
      </div>
    </div>
  \`;
}

function setActiveDiff(i) {
  window._activeDiffIdx = i;
  render();
}

function render() {
  const root = document.getElementById("root");
  if (!panel) {
    root.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
    return;
  }

  const banner = renderActiveRun();
  const rows = panel.state.roles.map(renderRow).join("");
  const bk = \`
    <section style="margin-top:var(--space-7)">
      <h2>Backups</h2>
      \${renderBackups()}
    </section>
  \`;
  root.innerHTML = banner + '<section><h2>Dispatch configuration</h2>' + rows + '</section>' + bk + renderDiffModal();
}

// ── Boot ───────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [stateData, bkData] = await Promise.all([
      api("/api/state"),
      api("/api/backups"),
    ]);
    panel = stateData;
    backups = bkData.backups;
    drafts = {};
    for (const r of panel.state.roles) drafts[r.role] = defaultDraftFor(r);
    render();
  } catch (e) {
    document.getElementById("root").innerHTML =
      '<div class="banner error">Failed to load: ' + escapeHtml(e.message) + '</div>';
  }
}

// Notify the server when the tab closes so it can shut down
window.addEventListener("beforeunload", () => {
  navigator.sendBeacon(BASE + "/api/shutdown");
});

loadAll();

// expose for inline handlers
Object.assign(window, {
  onProviderChange, onModelChange, onEffortChange, onFallbackChange,
  onReset, onSave, onRevert, confirmSave, cancelDiff, setActiveDiff,
  loadAll,
});
</script>
</body>
</html>`;
}

// ── Public entrypoint ─────────────────────────────────────────
function startGui({ openBrowser = true } = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  let server;
  let shutdownRequested = false;
  let pendingShutdownTimer = null;

  const signalShutdown = (reason) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.log(""); // newline to clear the prompt line
    console.log(`shutting down (${reason})`);
    if (server) {
      server.close(() => process.exit(0));
      // hard-kill if close hangs
      setTimeout(() => process.exit(0), 1500).unref();
    } else {
      process.exit(0);
    }
  };

  const lifecycle = {
    scheduleShutdown(ms, reason) {
      if (shutdownRequested) return;
      if (pendingShutdownTimer) clearTimeout(pendingShutdownTimer);
      pendingShutdownTimer = setTimeout(() => {
        pendingShutdownTimer = null;
        signalShutdown(reason);
      }, ms);
    },
    cancelPendingShutdown() {
      if (pendingShutdownTimer) {
        clearTimeout(pendingShutdownTimer);
        pendingShutdownTimer = null;
      }
    },
  };

  const handler = buildHandler(token, signalShutdown, lifecycle);
  server = http.createServer(handler);

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}/${token}/`;
    console.log("");
    console.log("Dispatch Console GUI");
    console.log(`  ${url}`);
    console.log("");
    console.log("  bound to 127.0.0.1 only · token-gated · ephemeral");
    console.log("  Ctrl+C or close the tab to stop");
    console.log("");
    if (openBrowser) openInBrowser(url);
  });

  server.on("error", (e) => {
    console.error("server error:", e.message);
    process.exit(1);
  });

  process.on("SIGINT", () => signalShutdown("Ctrl+C"));
  process.on("SIGTERM", () => signalShutdown("SIGTERM"));
}

module.exports = { startGui };
