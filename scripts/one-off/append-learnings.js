#!/usr/bin/env node
/**
 * Append HIGH-confidence learnings from /research:deep run to learnings.jsonl.
 * Uses fs.appendFileSync to satisfy memory-guard hook (which blocks full writes).
 */

const fs = require("fs");
const path = require("path");

const LEARNINGS_PATH = ".claude/project/memory/learnings.jsonl";
const SOURCE = "deep-research/a2a-gaps";
const TS = "2026-05-01";

const learnings = [
  "The packaging layer for the long tail (plumber, CPA, paralegal, boutique consultant) is the highest-conviction A2A gap. Shopify Agentic Storefronts owns physical goods only; UCP owns consortium retailers; foundation-model app stores own developer plugins. Long-tail local services and expertise are uncovered.",
  "Don't compete on commerce rails — ride them. SPT (Stripe MPP, Mar 2026), AP2 (Google, Sept 2025), x402 (Coinbase, $50M+ cumulative) are commoditizing in 2026. Wrap all three behind a single 'set a price' UI; use SPT for fiat + x402 for sub-cent.",
  "Multi-hop A2A2A 'insurance claim → adjuster → payment' canonical example has no disclosed production implementation in 2026. Anchor Wave 00 messaging on Project Deal-style two-party flows (buyer ↔ seller agents — these DO ship, 186 deals zero human intervention at Anthropic April 2026); frame chains as upside, not current reality.",
  "Foundation-model absorption is the #1 contrarian threat. Anthropic Project Deal (186 deals, $4K, zero human intervention, Apr 2026), OpenAI Apps SDK directory, Shopify+Google UCP (Mar 2026 — Etsy/Walmart/Visa/Mastercard/Stripe/Klarna/Adyen all signed). Window narrows every quarter; sequence Wave 01→03 fast.",
  "Trust is the most differentiated wedge. AgentSeal scanned 1,808 MCP servers — 66% had findings, only 12.9% scored high-trust (≥70/100). ATEP IETF draft and W3C VC drafts exist but none ships at SMB layer. A 'verified pizza shop / verified plumber' trust badge with cryptographic backing is buildable in 2026 and has no obvious incumbent.",
  "x402 has no native dispute/chargeback primitive — settlement is final on-chain. AP2 Mandates create audit trails but not arbitration. Build escrow + automated rollback as a primary product (real moat vs Shopify's chargeback machinery and Coinbase's settlement-final model).",
  "MCP version churn is a hidden tax — 4 breaking spec revisions in 16-18 months, no semver semantics (YYYY-MM-DD versioning, SEP-1400 in flight). Pin protocol versions; use capability discovery negotiation; treat the published agent surface as a version-stable API even though spec churns every ~3 months.",
  "Self-build at runtime is real but doesn't kill registries. Cloudflare Project Think achieved 99.9% token reduction (1k vs 1.17M); Anthropic Code Execution with MCP achieved 98.7% (2k vs 150k). Self-build doesn't solve trust/reputation, and a non-developer cannot publish 'OpenAPI + auth' — the bar is still too high for the long tail.",
  "The current Wave 00 prepare_order → place_order flow with mandatory confirmation is structurally aligned with AP2 Cart Mandates (ECDSA-signed JSON-LD: Intent → Cart → Payment). When AP2 client SDKs stabilize, refactor place_order to issue a Cart Mandate signed by the user's webapp identity — aligns to AP2 standard for free.",
  "Postpone ERC-8004 / on-chain agent reputation. It's Web3-niche and adds friction for SMB providers. Watch instead: Apple's WWDC 2026 (June) — if Apple ships a Siri agent commerce primitive, it's a discontinuity worth a strategy revisit.",
];

let appended = 0;
for (const tip of learnings) {
  const record = {
    ts: TS,
    intent: "external",
    tip,
    effective: null,
    pending_validation: true,
    score: 0,
    source: SOURCE,
  };
  fs.appendFileSync(LEARNINGS_PATH, JSON.stringify(record) + "\n");
  appended++;
}

console.log(`Appended ${appended} learnings to ${LEARNINGS_PATH}`);
