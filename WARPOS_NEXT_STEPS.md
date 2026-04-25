# WarpOS — Next Steps After Setup

WarpOS was just installed on this project on 2026-04-17T21:30:36.312Z.

## 1. Close this Claude Code session and open a fresh one

The installer registered hooks in `.claude/settings.json`, but **Claude Code
only reads settings.json on launch**. Any session currently open is still
running on pre-install settings — hooks won't fire. Close + reopen Claude Code
in this project before doing anything else.

Keep this terminal's history visible in another window if you want to reference
what the install did — this file is also here for that.

## 2. Merge Alex into CLAUDE.md (if needed)

The installer preserved your existing `CLAUDE.md` (if you had one). But WarpOS
needs the Alex α identity, autonomy rules, and β consultation protocol active
for `/mode:*` and agent dispatch to work. In the fresh session, run:

```
/warp:setup
```

It will detect the partial install, offer to merge `../WarpOS/CLAUDE.md` into
yours (three strategies: append / replace / interactive), and finish any
remaining steps. If you installed via the raw `warp-setup.js` script, this
is the step you haven't run yet.

## 3. Verify

```
/warp:health            # overall status — expect mostly green
/check:environment      # provider CLIs + auth detection
/check:system           # manifest vs disk, expect 0 drift
/discover:systems       # 6-angle inventory — expect Solid ~10
```

## 4. Generate maps

```
/maps:all               # architecture, hooks, memory, skills, systems, tools
```

## 5. Take the tour

```
/warp:tour              # guided walkthrough of every WarpOS subsystem
```

## 6. Start using it

- Type `/mode:solo` to stay solo for your first hour
- Try `/fix:fast "any error message"` for a quick fix
- Try "Help me write a product brief for this project" — Alex will guide you through `requirements/`

## Read

- `USER_GUIDE.md` in the WarpOS repo (at `../WarpOS/USER_GUIDE.md`) — the workflow docs
- `CLAUDE.md` at the root of this project — Alex identity
- `AGENTS.md` — agent system reference

## If anything fails

- Run `/warp:uninstall` to remove WarpOS cleanly (reverts CLAUDE.md, settings, deletes .claude/)
- Your pre-install state is backed up at `.warpos-backup/<timestamp>/`
- File an issue at https://github.com/cygaco/WarpOS/issues

---

Written by `warp-setup.js`. Safe to delete after your first successful session.
