#!/usr/bin/env node
"use strict";
const { writeYaml, nowIso } = require("../sprint/fs");
const SPRINT = require("../sprint/paths");
const path = require("path");

const now = nowIso();

const current = {
  schema: "warpos/sprint/current-sprint/v1",
  id: "SP-20260512-002",
  title: "Compatibility layer — real restaurant + real items + real prices",
  objective:
    "Graduate the compatibility layer from a single-intent pizza gate into a per-item orchestrator across pizzas, sides, drinks, brands, prices, and deals. Five linked pieces: extend checkItemAvailability to intent_items with per-item evidence tiers; flip start_pizza_order entry flow (intent first); enforce brand-aware default suppression when real evidence exists; harden the price-honesty wall in narration and pre-cart totals; gate deal narration on verified component-cart match + savings math.",
  status: "planning",
  created_at: now,
  updated_at: now,
  source_request:
    "Close the full compatibility-layer gap so the concierge picks restaurants by 'who nearby actually delivers + actually has what I want + at a price we can quote' across pizzas, sides, and drinks. Extend checkItemAvailability to intent_items (pizza style + sides-by-name + drinks-by-name-and-brand-and-size) with per-item evidence tiers (menu_match=available/high, places_generic=unknown/low, PIZZA_CUISINE_DEFAULTS=display-only-no-availability). Flip start_pizza_order entry flow (intent first, then discovery+compatibility); rank with quality scoring (delivers + covers + has-every-item-at-known-prices). Extend menu-discovery brand evidence so a Pepsi shop surfaces real Pepsi entries and defaults retreat when real evidence exists. Harden price-honesty wall in narration AND pre-prepare_order totals so unknown prices render as 'TBC on call' rather than synthesized averages. Bring deals/promotions under the same regime: name a deal only with verified savings math AND component-cart-match, otherwise surface as deals page only. The whole change is the compatibility layer graduating from a pizza-only gate to the orchestrator of 'real restaurant + real items + real prices'.",
  interpreted_intent:
    "Graduate the compatibility layer from a single-intent pizza gate into a per-item orchestrator of 'real restaurant + real items + real prices' across pizzas, sides, drinks, brands, and deals. Reuse the evidence tiers already established for pizza item-availability (menu_match=high, places_generic=low, PIZZA_CUISINE_DEFAULTS=display-only-no-availability) and apply them per-item. Flip the entry flow so intent precedes address; rank with quality scoring (covered+delivers+has-every-item-at-known-prices) instead of the current ordinal go/caution/no_go. Suppress brand-mismatched defaults when real brand evidence exists. Close pre-cart total synthesis paths so unknown prices never become spoken averages. Gate deal-narration on component-cart match plus verified savings math. Apply the resulting narration and ranking rules uniformly across the three concierge surfaces (MCP, webapp, A2A) preserving the type-wall and narration-honesty guarantees the menu-honesty sprint just shipped (commit 68b1b58).",
  plan_contract: ".claude/project/sprint/plan-contracts/PC-20260512-0004.yaml",
  risk_level: "medium",
  approval_state: "none_required",
  current_phase: "plan",
  recommended_mode: "adhoc",
  mode_invocation_required_by_user: true,
  external_services: {
    identified: [],
    blocked: [],
    ready: [],
    mocked: [],
    deferred: [],
  },
  tickets: {
    proposed: [],
    planned: [],
    designed: [],
    ready_for_execution: [],
    in_progress: [],
    blocked: [],
    waiting_on_human: [],
    waiting_on_external_service: [],
    in_review: [],
    qa_failed: [],
    redteam_failed: [],
    done: [],
    released: [],
    deferred: [],
    abandoned: [],
    reopened: [],
    superseded: [],
  },
  requirements: {
    prd: null,
    high_level_stories: null,
    granular_stories: null,
    copy: null,
    inputs: null,
    trace: null,
    acceptance_criteria: null,
    qa_plan: null,
    redteam_plan: null,
    release_plan: null,
  },
  checks: {
    lint: { status: "not_run", last_run: null, evidence: "" },
    typecheck: { status: "not_run", last_run: null, evidence: "" },
    tests: { status: "not_run", last_run: null, evidence: "" },
    build: { status: "not_run", last_run: null, evidence: "" },
    qa: { status: "not_run", last_run: null, evidence: "" },
    redteam: { status: "not_run", last_run: null, evidence: "" },
  },
  approvals: {
    plan: { required: false, state: "not_required", ref: null },
    design: { required: false, state: "not_required", ref: null },
    execution: { required: false, state: "not_required", ref: null },
    release: { required: true, state: "not_yet_requested", ref: null },
    external_services: { required: false, state: "not_required", ref: null },
  },
  reports: {
    plan: ".claude/project/sprint/plan-contracts/PC-20260512-0004.report.md",
    design: null,
    execution: null,
    release: null,
  },
  ralph: {
    active: false,
    current_ticket: null,
    current_loop: null,
    status: "idle",
    last_checkpoint: null,
    next_action: null,
  },
  crash_recovery: {
    last_checkpoint: null,
    resume_command: "/sprint:design",
    resume_summary:
      "Plan Contract PC-20260512-0004 created. Next: /sprint:design.",
    active_files: [],
    dirty_state: false,
    blockers: [],
    safe_to_continue: true,
  },
  prior_sprint: {
    id: "SP-20260512-001",
    status: "released",
    archived_to: ".claude/project/sprint/history/SP-20260512-001.yaml",
    note: "Menu honesty sprint shipped 2026-05-12T22:00 UTC. Type-wall + narration parity in place across MCP/webapp/A2A — this sprint extends those guarantees.",
  },
};

writeYaml(SPRINT.current, current);
process.stdout.write(`wrote ${SPRINT.current}\n`);
