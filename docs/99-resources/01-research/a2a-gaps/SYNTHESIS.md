# A2A Gaps — Deep Research Synthesis

**Date:** 2026-05-01
**Method:** Real Deep Research — OpenAI o3-deep-research (4-phase) + Gemini deep-research-pro-preview-12-2025 + Claude 3-round WebSearch
**Brief by:** Gemini Thinking (gemini-3.1-pro-preview)
**Engines:** All 3 succeeded ✓ (OpenAI: 145k chars, Gemini: 49k chars, Claude: 5k words)
**Original query:** Identify gaps in the A2A space that "The AI Web" platform could fill — anchored on discovery, trust, compatibility, commerce.
**Estimated cost:** ~$8-15 (OpenAI o3 deep research × 4 phases ≈ $5–10; Gemini ≈ $1–3; Claude included).

## Executive Summary

The four A2A primitives — discovery, trust, compatibility, commerce — are **individually solved by developer-centric tooling but no rail unifies them for non-developer providers**. The strongest verified gap is a **packaging layer for non-developers**: a pizza shop, plumber, paralegal, or boutique consultant cannot publish a verifiable, agent-discoverable, payment-routable presence in under 10 minutes today. Shopify Agentic Storefronts gets closest but only works for physical-goods commerce on Shopify rails. The strongest verified contrarian threat is **foundation-model absorption**: Anthropic's Project Deal (Apr 2026, 186 deals, $4K, zero human intervention), OpenAI's Apps SDK directory, and Shopify+Google's Universal Commerce Protocol (March 2026 — Etsy, Walmart, Visa, Mastercard, Adyen, Klarna all signed) suggest the major platforms are racing to internalize discovery and commerce inside their model surfaces, leaving an independent registry with shrinking shelf space for the long tail.

## Cross-Validation Matrix

| Finding | OpenAI | Gemini | Claude | Verified | Confidence |
|---------|--------|--------|--------|----------|------------|
| Four primitives are individually solved but fragmented for non-devs | agree | agree | agree | Y | HIGH |
| Stripe MPP + SPT live with named partners (Mar 2026) | agree | agree | agree (Browserbase, PostalForm, Prospect Butcher, Stripe Climate) | Y (primary stripe.com) | HIGH |
| Coinbase x402 in production with sub-cent USDC settlement | agree | agree | agree ($50M+ cumulative, 69K agents, 165M tx) | Y (primary docs) | HIGH |
| Google AP2 with Verifiable Mandates (60+ launch partners) | agree | agree | agree | Y (cloud.google.com) | HIGH |
| Shopify Agentic Storefronts is closest existing GMB-for-agents (physical goods only) | silent | partial | agree | Y (shopify.com) | HIGH |
| Universal Commerce Protocol (Shopify+Google, Mar 2026) folds discovery+payment+identity | silent | silent | agree (with full partner list: Etsy, Walmart, Visa, Mastercard, Adyen, Klarna) | Y (shopify.engineering/ucp) | HIGH |
| Anthropic Project Deal (Apr 2026): 186 deals, $4K, zero human intervention | silent | silent | agree (primary source verified) | Y (anthropic.com) | HIGH |
| MCP discovery layer (Smithery, Glama, MCPfinder) is developer-only | agree | agree | agree | Y | HIGH |
| Trust degrades over multi-hop A2A2A chains | agree (heavy) | agree | agree (cited eprint.iacr.org/2026/497 — 50-agent system fails minutes) | Y | HIGH |
| 4 MCP breaking spec revisions in 16-18 months | agree | partial | agree (Pieter Levels, Garry Tan critiques cited) | Y | HIGH |
| Foundation-model absorption is #1 contrarian threat | agree (HIGH conf) | agree (HIGH conf) | agree (MEDIUM-HIGH) | Y (multiple primary sources) | HIGH |
| Self-build at runtime is cheap (~98% token reduction) | partial | agree | agree (Cloudflare 99.9%, Anthropic 98.7%) | Y (primary blog.cloudflare.com / anthropic.com/engineering) | HIGH |
| AgentSeal: 66% of 1,808 MCP servers have security findings | silent | partial | agree (with 4.2% FP rate, 12.9% high-trust threshold) | Y (agentseal.org) | HIGH |
| 84% prompt injection success against agentic IDEs | silent | silent | agree (arXiv 2509.22040) | Y | HIGH |
| Multi-hop insurance claim → adjuster → payment exists in production | silent | implied | flagged as UNVERIFIABLE in public sources | N | LOW |
| ERC-8004 Web3 reputation as agent trust standard | agree | silent | silent | Partial | MEDIUM |
| x402 has no native dispute/chargeback primitive | agree | agree | agree | Y | HIGH |
| Apple's role in agent commerce primitives | speculative (Gemini-in-Siri rumor) | silent | flagged as gap remaining | N | LOW |
| 78% of enterprise AI teams have MCP in production (Apr 2026) | silent | silent | agree (Zuplo State of MCP) | Y | HIGH |
| 150+ orgs running A2A in production | agree | agree | agree | Y | HIGH |

## Consensus (all engines agree)

1. **The packaging gap is real and unfilled.** All three engines converge on the same diagnosis: every primitive exists, but no product unifies them for non-developers. Today's options (Smithery, Glama, FastMCP, Speakeasy, Mintlify) require code; Shopify Agentic Storefronts only handles physical goods.

2. **Commerce rails are commoditizing fast.** Stripe MPP (March 2026), Google AP2 (Sept 2025), Coinbase x402 (live with $50M+ cumulative volume) all shipped within ~12 months. The infrastructure layer is no longer the moat — the storefront / publisher / dispute layer is.

3. **Trust is the weakest leg.** All three engines agree multi-hop chains degrade trust; AP2 mandates partially address single-hop authorization audit, but cross-platform chained spend caps and dispute resolution lack a unified primitive. AgentSeal's 66% security-finding rate (Claude) and ATEP/VC drafts (Claude+Gemini) confirm the surface area is largely unprotected.

4. **Foundation models are absorbing primitives at speed.** OpenAI Apps SDK, Anthropic Project Deal, Shopify+Google UCP, and the rumored $40B Google→Anthropic investment (Claude) all point to vertical integration tightening through 2026.

5. **Self-build at runtime is economically real but doesn't kill registries.** Anthropic Code Execution with MCP (98.7% token reduction) and Cloudflare Project Think (99.9% reduction) prove agents can read OpenAPI specs and write connectors. But: self-build doesn't solve trust/reputation, and a non-developer cannot publish "OpenAPI + auth" — the bar is still too high for the long tail.

## High-Confidence Insights (verified against primary sources)

- **Stripe SPT mechanics are settled.** Shared Payment Tokens scope to a merchant, cap a cart-total via `usage_limits.max_amount`, and time-box via `usage_limits.expires_at`. Live partners: Browserbase, PostalForm, Prospect Butcher Co., Stripe Climate. Visa, Mastercard, Affirm, Klarna, Adyen integrated by March 2026. *Source: stripe.com/blog/machine-payments-protocol, docs.stripe.com/agentic-commerce.*

- **x402 is fee-free at the protocol level, sub-2-second settlement, ~$0.0001 cost.** April 2026 numbers: ~69,000 active agents, 165M+ transactions, $50M cumulative volume; 119M tx on Base + 35M on Solana. >98% of agent payments use USDC (Circle). x402 Foundation co-launched by Cloudflare + Coinbase. *Sources: docs.cdp.coinbase.com/x402, coinbase.com/blog.*

- **AP2 uses ECDSA-signed JSON-LD mandates** — Intent → Cart → Payment — composable with x402 on-chain and MPP/SPT off-chain. 60+ launch partners including Coinbase, Salesforce, Adyen, Mastercard. *Source: cloud.google.com/blog, ap2-protocol.org.*

- **MCP scale**: ~97M monthly SDK downloads (March 2026, ~970× growth in 18 months); 9,400+ servers in public registry; 78% of enterprise AI teams report at least one MCP-backed agent in production (Apr 2026, Zuplo). *Sources: mcpmanager.ai, pulsemcp.com/statistics.*

- **Shopify Agentic Storefronts (Winter 2026)** auto-syndicates products to ChatGPT, Microsoft Copilot, Perplexity, Google AI Mode, and Gemini from one admin checkbox. Agentic Plan exists for non-Shopify merchants who can list to Shopify Catalog without migrating their store. *Source: shopify.com/news/winter-26-edition-agentic-storefronts.*

- **Universal Commerce Protocol (Shopify+Google, March 3 2026)** is built on MCP+A2A as transports and adds commerce primitives: declared capabilities, payment-handler advertising, identity linking. Endorsed by Etsy, Target, Walmart, Wayfair, Adyen, Amex, Mastercard, Stripe, Visa, Klarna, Affirm. *Sources: shopify.engineering/ucp, developers.googleblog.com.*

- **AgentSeal scanned 1,808 MCP servers** — 66% had ≥1 security finding (43% command injection, 20% tooling infra, 13% auth bypass, 10% path traversal); only 12.9% scored "high trust" (≥70/100). False-positive rate: 4.2% against 120 known-benign servers. *Source: agentseal.org/blog.*

- **Anthropic Project Deal (April 2026)** — 69 employees, 186 deals, ~$4K, **zero human intervention** between agents. Users with Haiku models lost ~$2.45/item as buyer and ~$2.68/item as seller vs Opus, but rated fairness identically (4.05 vs 4.06 on 7-point scale) — silent quality inequality. *Source: anthropic.com/features/project-deal.*

- **Postmark-mcp supply-chain attack** (Q1 2026) — first publicly documented malicious MCP server. 15 clean versions built trust; v1.0.16 added one line BCC'ing every email. ~1,500 weekly downloads, ~300 organizations integrated at discovery. PipeLab State of MCP Security 2026: 9 of 11 MCP registries successfully poisoned with trial balloons. *Sources: ox.security/blog, pipelab.org.*

- **Project Think (Cloudflare) and Code Execution with MCP (Anthropic)** demonstrate runtime self-build economics: 1,000 tokens of search/execute beats 1.17M tokens of tool-per-endpoint exposure (99.9% reduction); 2,000 tokens of code beats 150,000 tokens of pre-loaded tool definitions (98.7% reduction). *Sources: blog.cloudflare.com/project-think, anthropic.com/engineering/code-execution-with-mcp.*

## Disagreements & Resolution

- **Registry size estimates:** OpenAI cited "agentic-card.com 4,000+ agents" and "Glama 22,548 servers"; Claude cited "Smithery ~7,000, Glama 21,000+"; Gemini didn't quote. **Resolution:** numbers are consistent within reporting noise — Glama at ~21–22K, Smithery at ~7K, agentic-card.com at ~4K. Different registries, not contradictory.

- **Insurance claim multi-hop chain (canonical brief example):** OpenAI describes the flow abstractly; Gemini describes the imaging-agent / billing-agent pattern citing IBM watsonx + Calque; **Claude flagged it as UNVERIFIABLE in public sources** — Dwolla/Stripe content found is bank-A2A (account-to-account), not agent-to-agent. **Resolution:** the canonical multi-hop A2A2A insurance example in the brief is **aspirational, not yet a verified production case**. Treat as future state when scoping demos.

- **ERC-8004 (on-chain agent reputation):** OpenAI heavily cites this; Claude/Gemini barely mention. **Resolution:** ERC-8004 is real but Web3-niche; for non-developer SMB providers it is irrelevant friction. Note for completeness; do not center the bet on it.

- **Apple's role:** OpenAI cites a TechRadar rumor about Gemini-in-Siri; Claude flags as gap remaining; Gemini silent. **Resolution:** No public Apple agent-commerce product exists as of May 2026. Watch for WWDC 2026 announcements (Siri agent integration) — could be a discontinuity.

## Hallucination Check

Verified the following high-stakes claims by hitting primary sources during synthesis:

- ✓ Anthropic Project Deal numbers (186 deals / $4K / 69 employees / zero human intervention) — anthropic.com primary
- ✓ Stripe MPP March 2026 + SPT live partners — stripe.com/blog primary
- ✓ x402 cumulative volume / agent count — coinbase.com primary
- ✓ AgentSeal 1,808 servers / 66% findings — agentseal.org/blog primary
- ✓ Shopify UCP March 3 2026 partners — shopify.engineering/ucp + developers.googleblog.com primary
- ✓ MCP downloads 97M/month — pulsemcp.com/statistics primary

No clear hallucinations detected. One source (`stellagent.ai`) heavily cited by OpenAI is a smaller secondary outlet; Claude's parallel citations to a2a-protocol.org primary back the same claims, so OpenAI's analysis is sound but its citation surface is shallower than Claude's on protocol details.

## Sub-Question Answers

### SQ1 — What registries/standards exist for machine-readable discovery and reputation?
**Answer:** Four distinct discovery approaches in 2026: (1) developer-only MCP package registries (Smithery ~7K, Glama ~21K, MCPfinder unifying the rest); (2) A2A Agent Cards via `.well-known/agent-card.json` adopted by 150+ orgs but spec doesn't mandate verification; (3) DID-based / ANS / SD-JWT identity drafts (POCs, no disclosed production); (4) curated scorecards (MCP-Scorecard, AgentSeal) used as discovery filters. **None publish-able by a non-developer in < 10 minutes.**
**Confidence:** HIGH. **Best source:** glama.ai, smithery.ai, agentseal.org, a2a-protocol.org/v0.3.0.

### SQ2 — What platforms allow non-developers to publish agentic services?
**Answer:** Effectively none for the long tail. Closest: **Shopify Agentic Storefronts (Winter 2026)** for physical-goods commerce; Google Cloud Marketplace AI Agents requires A2A Agent Card authoring + GCP onboarding; Alhena offers declarative no-code agent config but is narrow-vertical. **Long-tail local services (plumber, paralegal, boutique consultant) have no equivalent product.**
**Confidence:** HIGH. **Best source:** shopify.com/news/winter-26-edition-agentic-storefronts.

### SQ3 — How do agents programmatically verify trust before transacting?
**Answer:** Three layered mechanics: (1) AP2 mandate signing chain (ECDSA on JSON-LD, Intent→Cart→Payment, 60+ partners in production); (2) W3C VC + DID presentation via DIF Presentation Exchange (arXiv 2511.02841 demo, limited production); (3) third-party scorecards (AgentSeal, MCP-Scorecard) as runtime filters. **No unified runtime trust query exists** — each gateway treats trust differently and 12.9% of MCP servers meet AgentSeal's high-trust bar.
**Confidence:** HIGH. **Best source:** ap2-protocol.org/specification, agentseal.org/blog, eprint.iacr.org/2026/497.pdf.

### SQ4 — Production multi-hop A2A2A chains?
**Answer:** **No public production example of the canonical "insurance claim → adjuster → payment" chain found.** Production multi-hop exists in narrower form (orchestrator→specialist agent fan-out at IBM watsonx, Microsoft Copilot Studio, Anthropic Project Deal's 186 buyer/seller pairings) but the cross-organizational 4-hop chain remains aspirational in May 2026.
**Confidence:** LOW (claim absent from public sources). **Best source:** anthropic.com/features/project-deal as the closest disclosed multi-agent commerce in production.

### SQ5 — What breaks (failure modes)?
**Answer:** 10+ documented failure modes: (1) tool poisoning / prompt injection (84% success rate, arXiv 2509.22040); (2) supply-chain malicious packages (postmark-mcp, 9 of 11 registries poisoned in trial); (3) RCE via inadequate stdio sanitization (7+ critical CVEs, 200K servers exposed per OX Security); (4) cross-agent credential leakage in chains (Red Hat); (5) cascading injection across trust boundaries; (6) protocol churn (4 MCP breaking revisions in 18 months); (7) stale/shadow MCP servers; (8) silent agent quality inequality (Project Deal Haiku vs Opus); (9) agent confabulation / accidental purchases; (10) refund/dispute paths under-specified for x402.
**Confidence:** HIGH. **Best sources:** ox.security, agentseal.org, anthropic.com/features/project-deal.

### SQ6 — Strongest contrarian arguments?
**Answer:** Three substantive: (1) **Foundation-model absorption** — OpenAI Apps SDK + Anthropic Project Deal + Shopify+Google UCP + $40B Google→Anthropic all tighten vertical integration; (2) **Runtime self-build economics** — 98.7–99.9% token reduction makes "read docs, write connector" viable for capable models, but doesn't solve trust; (3) **Protocol churn** — 4 MCP breaking revisions in 18 months mean a publisher built on MCP/A2A in 2026 may rebuild in 2027. UCP's March 2026 convergence may be ending the churn era.
**Confidence:** HIGH on (1) and (3); MEDIUM on (2). **Best sources:** anthropic.com/features/project-deal, blog.cloudflare.com/project-think, modelcontextprotocol.io/specification/versioning.

## Practical Takeaways (ranked by confidence × actionability)

1. **The packaging layer for the long tail is the single highest-conviction opportunity.** Shopify Agentic Storefronts owns physical goods; UCP owns the consortium retailers; foundation-model app stores own developer plugins. **Local services and expertise (plumber, CPA, paralegal, boutique consultant) are still uncovered.** Confidence: HIGH; Actionable: now.

2. **Don't compete on commerce rails — ride them.** SPT, AP2, x402 are commoditizing in 2026. Pick all three (start with SPT for fiat + x402 for sub-cent), wrap them behind a single "set a price" UI. Confidence: HIGH; Actionable: now.

3. **Trust is the most differentiated wedge.** AgentSeal scoring infrastructure exists; ATEP IETF draft is real; W3C VCs are real — but none of them ship at the SMB layer. A platform that issues a "verified pizza shop / verified plumber / verified paralegal" trust badge with cryptographic backing is technically buildable in 2026 and has no obvious incumbent. Confidence: HIGH; Actionable: soon.

4. **Wave 00 → Wave 01 sequencing should respect the contrarian threat.** The window for an independent publisher narrows every quarter that Shopify+Google+OpenAI+Anthropic ship integrated commerce. Move from pizza → plumber-class services → AAA expert agents fast (do not linger on B2C). Confidence: MEDIUM-HIGH; Actionable: soon.

5. **Build dispute/refund as a primary product, not an afterthought.** x402 has zero native dispute primitive; AP2 mandates create audit trails but not arbitration. A platform that escrows + automates rollback across the chain is a real moat against both Shopify (which uses Stripe's chargeback machinery, not agent-native arbitration) and Coinbase (settlement-final on chain). Confidence: MEDIUM-HIGH; Actionable: later (after Wave 00).

6. **Multi-hop A2A2A is a future claim, not a current reality.** Don't anchor pitches on "insurance claim → adjuster → payment" as if it ships in production. Anchor on Project Deal-style two-party flows (buyer ↔ seller agents) — which DO ship — and frame chains as the upside. Confidence: HIGH; Actionable: now (messaging change).

7. **MCP version churn is a hidden tax.** Pin protocol versions; use capability discovery negotiation; runtime feature-flag detection. Treat your published agent surface as a version-stable API even though the underlying spec churns every ~3 months. Confidence: HIGH; Actionable: now.

## Applicability to This Project (aiweb / Wave 00)

**Wave 00 (current):** A pizza-ordering MCP server + webapp + A2A endpoint + Bland.ai voice + encrypted user profile storage on Fly.io. The research validates the supply-side bet: MCP is at 97M monthly SDK downloads with 78% enterprise penetration; A2A has 150+ orgs in production. The pizza demo (test_vlad with `orderConfirmed:true` as the milestone — per project memory) is a **defensible time-to-pizza proof** in a real ecosystem with real adoption data.

**Wave 01 → 03 implications from this research:**
- **Wave 01 (vibe coders + solo founders):** GitHub/Vercel/Replit publishing path is correct. But the differentiator vs Smithery is *trust signals + commerce wiring*, not just discovery. Bundle SPT/x402 wiring into the publish flow.
- **Wave 02 (agencies):** Multi-tenant + white-label is correct. The trust scorecard (own AgentSeal-equivalent or partner with them) becomes the agency's pitch — "we get your clients verified-trusted" — not just "we get them listed."
- **Wave 03 (AAA expert providers):** The big unlock per the brief. Research confirms: per-query commerce is technically real (x402 sub-cent + AP2 mandates), CPA/paralegal market is structurally underserved (no equivalent product exists), and the "describe → generate" path scales because non-developers don't need to author OpenAPI / agent-card.json by hand.

**Immediate concrete suggestions:**
- The current `prepare_order → place_order` flow with mandatory confirmation is **structurally aligned with AP2 Cart Mandates**. When AP2 client SDKs stabilize, refactor `place_order` to issue a Cart Mandate signed by the user's webapp identity — this aligns Wave 00 with the AP2 standard for free.
- The encrypted profile storage on Fly.io with tokenHash keying is the right substrate for issuing per-provider trust passports later. Don't rebuild — extend.
- Continue the dual-surface (webapp + Claude Desktop bridge) pattern; both are shipping demand surfaces. Add an A2A Agent Card surfaced at `.well-known/agent-card.json` for Wave 01 readiness.
- **Postpone:** ERC-8004 / on-chain reputation. It's Web3-niche and adds friction for SMB providers.
- **Watch:** Apple's WWDC 2026 (June). If Apple ships a Siri agent commerce primitive, that's a discontinuity.

## Gaps & Future Research

**Phase 1 — Landscape**
- Apple's role in agent commerce — no public product as of May 2026; revisit after WWDC 2026.
- Non-Shopify SMB platforms (Square, Wix, BigCommerce) for agentic publishing — not covered in disclosed sources.

**Phase 2 — Mechanics**
- The canonical "insurance claim → adjuster → payment" multi-hop A2A2A example has **no disclosed production implementation**. Either a real production case study needs to surface, or the brief should refactor messaging away from this aspirational framing.
- Cross-platform chained spend caps: SPT and AP2 each handle single-hop; chained caps across 3+ hops lack a unified primitive.

**Phase 3 — Failure Modes**
- Real x402 refund/dispute case studies are not published. Mechanics are clear (settlement is final on-chain) but production reconciliation patterns are private.
- mTLS certificate rotation across cross-org agent fleets at scale: acknowledged in IETF drafts but no published incident report.

**Phase 4 — Contrarian**
- Whether non-developers actually want agent-discoverable presence (demand-side question) — no consumer/SMB survey data on whether long-tail providers see agent traffic as a revenue channel today.

## Engine Performance

| Engine | Method | Duration | Sources Found | Report Length |
|--------|--------|----------|---------------|---------------|
| OpenAI | o3-deep-research, 4-phase background API | 25 min (302+363+303+242s + 90s×3 cooldown) | ~25–30 distinct URLs cited | 145,396 chars (~376 lines) |
| Gemini | deep-research-pro-preview-12-2025 Interactions API | ~5 min (288s) | ~45 unique citations indexed | 49,335 chars (~346 lines) |
| Claude | 3-round WebSearch + WebFetch | ~7 min (432s) | ~50 distinct URLs in registry | ~5,000 words (~236 lines) |

Claude won on source verification rigor (primary-source verification pass, explicit confidence labeling per finding, gap-flagging like the unverifiable insurance chain). OpenAI won on volume and exhaustive analytical depth per phase. Gemini won on speed and breadth of citation indexing. Together: a usable cross-validated picture.

## Raw Reports

- [OpenAI Report](openai-report.md) — o3-deep-research, 4-phase
- [Gemini Report](gemini-report.md) — deep-research-pro-preview-12-2025
- [Claude Report](claude-report.md) — 3-round iterative WebSearch
- [Research Brief](BRIEF.md) — Generated by Gemini Thinking
- [Brief JSON](brief.json) — Machine-readable
