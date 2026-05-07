# YC Application Brief — AI Web (Pizza Concierge → Agentic Compatibility Layer)

> Generated 2026-05-06 by Alex α + a research subagent (2 web searches, 2026 landscape evidence).
> Paste-ready for the YC application narrative. Sources cited inline at bottom.

## Hook
AI agents can talk to long-tail SMBs, but they can't trust what comes back. When Claude Desktop "orders a pizza" today, three failure classes silently corrupt the transaction: the restaurant is out of the item, doesn't deliver, or delivers somewhere else. Every agentic-commerce protocol shipping in 2026 — ACP, UCP, AP2, MCP, A2A, Visa TAP — assumes merchant opt-in, which leaves the long tail of millions of merchants invisible to agents (per Rye's 2026 landscape report and the eLLMo protocol survey).

## Wedge
Pizza ordering is the most over-determined consumer transaction on Earth: every variable (delivery radius, menu item, price, ETA) is a known field, and a single failed delivery is visceral evidence of a broken stack. We built a working pizza concierge MCP server (Domino's API + Google Places + Bland.ai voice fallback for non-API restaurants) where the compatibility verdict — go / caution / no_go across delivery availability, coverage, and item availability — runs at discovery time and blocks the order before payment.

## Vision
The pizza concierge is the wedge for a protocol-agnostic compatibility-and-trust layer for the supply-side agentic economy: the long-tail SMBs (plumbers, paralegals, boutique restaurants, local services) that foundation-model app stores will not absorb. Shopify Agentic Storefronts owns enterprise commerce; UCP owns the retailer consortium; OpenAI's GPT Store and Anthropic's tool directory own the developer-side plugin layer. Nobody owns "is this MCP server I just discovered actually able to fulfill what it advertises?"

## Why now
Three concurrent shifts make this the right month. **MCP version churn**: AgentSeal's Q1 2026 scan of 1,808 public MCP servers found 66% had findings and only 12.9% scored ≥70/100 on trust — the supply side is publishing faster than anyone can verify. **Protocol commoditization**: AP2 + x402 + Visa TAP + ACP are all converging on payment rails in H1 2026 (commercetools' April radar; SAP's January piece on discovery/payments/trust), which collapses payment differentiation and pushes the value upstream into discovery and compatibility. **Trust-layer entrants**: Fime announced an agentic-commerce trust-layer service in April 2026 and FACT is positioning as an agent-side audit layer — but both target enterprise merchants. The long tail is open.

## Why us
Three real demos failed in the last sprint — wrong-pizza, no-delivery, wrong-address — and instead of patching each one, we shipped a single compatibility primitive that prevents all three classes structurally. That's earnestness in Tan's sense (TechCrunch 2024 interview): the product spec was discovered by interacting with the technology, not by reading a market report. Co-founder builds at Warp Studio pace; we ship working systems, not decks.

## Traction proof
The pizza concierge runs end-to-end on a test_vlad fixture from start_pizza_order through prepare_order's confirmation_token to place_order's Bland.ai voice call. The compatibility layer is live in production code as of 2026-05-06 and structurally blocks the three observed failure classes at discovery time. The same MCP server demos on three surfaces today: Claude Desktop (via mcp-remote bridge), the A2A test panel, and a Bland.ai voice call — three surfaces, one tokenHash-keyed profile, one compatibility verdict.

## YC ask
W26 batch — to compress the timeline from "pizza compatibility primitive" to "general SMB agentic-commerce compatibility layer" before the foundation-model app stores extend coverage downstream.

---

## Sources

- [Garry Tan - TechCrunch on YC Secret Sauce (2024)](https://techcrunch.com/2024/05/22/garry-tan-y-combinator-accelerator-insights/)
- [Rye - The Agentic Commerce Landscape: Who's Building What in 2026](https://rye.com/blog/agentic-commerce-startups)
- [eLLMo AI - Agentic Commerce Protocol Landscape 2025-2026](https://www.tryellmo.ai/blog/agentic-commerce-protocol-landscape-2025-2026)
- [SAP News - Agentic AI Reshaping Commerce (Jan 2026)](https://news.sap.com/2026/01/agentic-ai-reshaping-commerce-discovery-payments-trust/)
- [commercetools - The Agentic Commerce Radar 2026](https://commercetools.com/blog/the-agentic-commerce-radar-key-market-shifts-insights)
- [Biometric Update - Fime launches agentic commerce trust layer (April 2026)](https://www.biometricupdate.com/202604/fime-launches-agentic-commerce-trust-layer-service)

**Note:** AgentSeal 1,808-server / 66%-findings / 12.9%-trust statistic is from prior in-repo deep-research, not the searches above.
