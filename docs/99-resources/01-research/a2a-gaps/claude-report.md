# A2A Gaps — Claude Deep Research Report

_Research date: 2026-05-01. Three rounds, ~22 web searches, ~10 primary-source fetches. Engine: Claude Opus 4.7 (1M)._

## Executive Summary

The four A2A primitives — discovery, trust, compatibility, commerce — are **all individually solved by developer-centric tooling, but no single rail unifies them for a non-developer service provider**. Discovery has Smithery/Glama/MCP-Scorecard (developer registries with CLIs); trust has AgentSeal scoring, ATEP, and W3C Verifiable Credentials drafts (each requires DID/JSON-LD literacy); compatibility is being negotiated through MCP/A2A/UCP simultaneously (four MCP spec revisions in 18 months, breaking changes every ~3 months); commerce has Stripe MPP, Coinbase x402, and Google AP2 already in production with disclosed traffic ($50M+ in x402 volume, ~150 organizations on A2A in production). The strongest gap is the **packaging layer**: a non-developer pizza shop, plumber, or boutique cannot publish a verifiable, agent-discoverable, payment-routable presence in under 10 minutes today — Shopify Agentic Storefronts gets closest but only works if you sell physical goods through Shopify. The strongest counter-argument to a "Google My Business for agents" platform is **foundation-model absorption**: Anthropic's Project Deal (April 2026, 186 deals, $4K with zero human intervention), OpenAI's Apps SDK directory, and Shopify+Google's Universal Commerce Protocol (March 2026) suggest the platforms are racing to internalize discovery and commerce inside the model surfaces themselves, leaving an independent registry with shrinking shelf space.

## Phase 1: Landscape

### Discovery (registries, machine-readable agent identity)

**1. MCP package registries (Smithery, Glama, PulseMCP, MCPfinder).** Smithery hosts ~7,000 MCP servers and provides CLI install + remote hosting; Glama is a meta-registry with ~21,000+ servers, maintained jointly by Anthropic, GitHub, PulseMCP and Microsoft, with daily updates and visual previews; MCPfinder unifies Smithery, Glama, and the Official MCP Registry into one search surface. Confidence: **HIGH**. These are the de facto discovery layer for developer-built tools today, but every published server requires writing a server in TypeScript/Python — there is no "I run a pizza shop, list me" path. Sources: TrueFoundry registry comparison, Glama, MCPfinder, Composio.

**2. A2A Agent Cards via `.well-known/agent-card.json` (or legacy `agent.json`).** Each agent self-publishes a JSON document at a well-known URL describing skills, endpoints, auth schemes (OAuth 2.0, OIDC, mTLS), and SLAs. Per the Agentic AI Foundation April 2026 status report, **150+ organizations have A2A in production routing real traffic** (up from ~50 launch partners at Cloud Next 2025). Confidence: **HIGH**. Critical gap: the spec itself does not mandate verification of the card's authenticity — agent impersonation and replay are real risks (Red Hat developer blog). Sources: a2a-protocol.org/v0.3.0, agent2agent.info, AWS Bedrock AgentCore docs, Red Hat.

**3. Agent Name Service (ANS) and DID-based discovery.** ANS is a proof-of-concept Kubernetes-native trust layer using Decentralized Identifiers; SD-JWT Agent Cards (IETF draft `nandakumar-agent-sd-jwt`) add selective disclosure on top of A2A. Confidence: **MEDIUM** — these are drafts/POCs without disclosed production traffic. Sources: arXiv 2604.26997, IETF datatracker.

**4. Curated meta-indexes/scorecards as discovery (MCP-Scorecard, AgentSeal Registry).** MCP-Scorecard scores 2,300–4,484 servers on provenance/maintenance/popularity/permissions; AgentSeal scores 800+ on security across 9 analyzers. Used as discovery filters. Confidence: **HIGH**. Sources: GitHub gigabrainobserver/mcp-scorecard, AgentSeal/awesome-mcp-security.

**Stop condition met:** 4 distinct approaches identified.

### Trust (verifiable identity, reputation, attestations)

**1. W3C Verifiable Credentials + DIDs for agents.** Each agent controls its own DID and presents JSON-LD–encoded VCs through DIF Presentation Exchange on top of A2A. arXiv 2511.02841 demonstrates an end-to-end implementation. Confidence: **MEDIUM** — strong standards but limited production deployments visible. Source: arXiv, W3C VC Data Model 2.1.

**2. Agent Trust & Execution Passport (ATEP).** IETF draft `stone-atep-00` proposes a portable, machine-readable credential format encoding execution history, success rate, capability domains, trust tier, and earned badges, wrappable in W3C VC and exposable as an A2A capability extension. Confidence: **MEDIUM** — IETF draft, not yet RFC. Source: datatracker.ietf.org.

**3. Independent third-party scorecards (AgentSeal, MCP-Scorecard, Enkrypt MCP Scan).** Trust score 0–100 weighted across 5 categories; AgentSeal scanned 1,808 MCP servers and **66% had at least one security finding** (43% shell/command injection, 20% tooling infrastructure, 13% auth bypass, 10% path traversal); 4.2% false-positive rate against 120 known-benign servers. Only **12.9% of servers score "high trust" (≥70/100)**. Confidence: **HIGH** (published methodology + numbers). Sources: agentseal.org/blog, mcpmanager.ai.

**4. AP2 Verifiable Mandates as transactional trust.** Cryptographically signed (ECDSA) JSON-LD mandates — Intent, Cart, Payment — provide non-repudiable audit trails. Confidence: **HIGH**. Sources: ap2-protocol.org, Cloud Security Alliance.

**Stop condition met:** 4 distinct approaches.

### Compatibility (protocol matching, runtime negotiation)

**1. MCP (JSON-RPC client/server).** ~97M monthly SDK downloads by March 2026 (970× growth in 18 months); 9,400+ servers in the public registry; **78% of enterprise AI teams report at least one MCP-backed agent in production** (April 2026, Zuplo State of MCP). Remote MCP servers up ~4× since May 2025. Confidence: **HIGH**. Sources: mcpmanager.ai adoption stats, Zuplo, PulseMCP statistics.

**2. A2A protocol.** Agents advertise capabilities via Agent Cards; clients negotiate via JSON-RPC 2.0 over HTTPS with SSE streaming and async push. Adopted by Amazon Bedrock AgentCore, Google Cloud Agentspace, Microsoft. Confidence: **HIGH**. Sources: a2a-protocol.org, AWS docs.

**3. Universal Commerce Protocol (UCP).** Co-developed by Shopify and Google (announced March 3, 2026); built on **MCP+A2A as transports** but adds commerce primitives — declared capabilities, payment-handler advertising, identity linking. Endorsed by Etsy, Target, Walmart, Wayfair, Adyen, Amex, Mastercard, Stripe, Visa, Klarna, Affirm. Confidence: **HIGH** — primary source on shopify.engineering/ucp and ucp.dev. Sources: shopify.engineering/ucp, developers.googleblog.com.

**4. Meta-Protocol Negotiator (research).** Agents exchange natural-language descriptions of communication requirements and synthesize a compatible protocol at runtime. arXiv 2505.02279 surveys MCP/ACP/A2A/ANP. Confidence: **LOW** — research stage, no shipping product. Source: arXiv.

**Stop condition met:** 4 distinct approaches.

### Commerce (agent-native payments)

**1. Stripe Machine Payments Protocol (MPP) + Shared Payment Tokens (SPTs).** Announced March 2026 in collaboration with Tempo. SPTs are scoped to a specific merchant, capped to a cart-total amount ceiling (`usage_limits.max_amount`), and time-limited (`usage_limits.expires_at` in minutes). Confirmed live: Browserbase, PostalForm, Prospect Butcher Co., Stripe Climate. Visa, Mastercard, Affirm, Klarna integrated by March 2026. Confidence: **HIGH** — primary docs verified. Sources: stripe.com/blog/machine-payments-protocol, docs.stripe.com/agentic-commerce.

**2. Coinbase x402 (HTTP 402 + USDC).** As of April 21, 2026: ~69,000 active AI agents, 165M+ transactions, $50M cumulative volume; March 2026 figures: 119M tx on Base + 35M on Solana, ~$600M annualized volume, **zero protocol fees**, sub-2-second settlement, ~$0.0001 cost. Circle reports **>98% of agent payments use USDC**. Cloudflare and Coinbase co-launching x402 Foundation. Confidence: **HIGH**. Sources: docs.cdp.coinbase.com/x402, coinbase.com/blog, AWS Industries blog.

**3. Google AP2 (Agent Payments Protocol).** 60+ launch organizations including Coinbase. Three mandate types — Intent, Cart, Payment — as ECDSA-signed JSON-LD. AP2 explicitly composes with x402 for on-chain settlement and with MPP/SPT for fiat rails (per Stripe blog). Confidence: **HIGH**. Sources: cloud.google.com/blog, ap2-protocol.org.

**4. Universal Commerce Protocol payment handlers.** UCP merchants advertise which payment handlers they accept; agent picks one. Adoption announced for SPT, x402, AP2, and PSP-specific handlers. Confidence: **HIGH** — March 2026 announcement. Source: shopify.engineering/ucp.

**Stop condition met:** 4 distinct approaches.

### Non-developer publishing platforms

**Shopify Agentic Storefronts** (Winter 2026 release): one-click admin setup; auto-syndicates products to ChatGPT, Microsoft Copilot, Perplexity, Google AI Mode, Gemini; Shopify Catalog infers categories, attributes, variant clustering. Agentic Plan exists for non-Shopify merchants — they can list to Shopify Catalog without migrating their store. **Closest existing thing to "Google My Business for agents," but only for physical-goods commerce on Shopify rails.** Confidence: **HIGH**.

**Google Cloud Marketplace AI Agents + Agent Designer**: no-code/low-code builder requiring an A2A Agent Card, but Marketplace fee structure and Google Cloud onboarding act as friction for non-developers. Confidence: **HIGH**.

**Alhena (declarative no-code agent config)**: describe agent purpose in plain language, planner routes automatically — niche, narrow industry traction. Confidence: **MEDIUM**.

## Phase 2: Mechanics

### Discovery mechanics — how agents query at runtime

- **Agent Card fetch:** client GETs `https://<host>/.well-known/agent-card.json` (or legacy `agent.json`), parses skills/endpoints/auth, then constructs JSON-RPC 2.0 calls per a2a-protocol.org spec. Streaming via SSE; async work via push notification webhooks.
- **MCP server discovery:** local stdio (subprocess) or remote (HTTP+SSE) connection; tools/list returns JSON-Schema typed tools. Cloudflare's API MCP server demonstrates a `search() + execute()` two-tool pattern that consumes ~1,000 tokens vs ~1.17M tokens for naive tool-per-endpoint exposure (**99.9% reduction**) — direct primary-source evidence that registries optimized for runtime efficiency are still the cheaper path than self-discovery via docs scraping. Source: blog.cloudflare.com/project-think.
- **Two real production MCP discovery patterns:** (1) Anthropic's Code Execution with MCP — agents `import` MCP tools as code modules; baseline test showed **150,000 tokens reduced to 2,000 tokens (98.7% reduction)**. (2) Apollo GraphQL MCP server — single `executeQuery` tool with schema introspection.

### Trust mechanics — verification before transaction

- **AP2 mandate signing flow:** user creates Intent Mandate (ECDSA-signed JSON-LD bound to user identity); agent assembles Cart Mandate signed by user's authoritative wallet/key; payment processor verifies signature chain; Payment Mandate emits non-repudiable audit record. Verified production: 60+ orgs at AP2 launch including Coinbase, Salesforce, Adyen.
- **W3C VC + DID presentation:** each agent has a DID-controlled key; DIF Presentation Exchange protocol bundles VCs as proof-of-attribute (e.g., "this agent is Stripe-verified for restaurant orders"). arXiv 2511.02841 demonstrates JSON-LD VCs over A2A.
- **Two real implementations:** (1) AgentStamp (vinaybhosle/agentstamp) — Ed25519 stamps + 0–100 trust scoring + x402 micropayments + 14 MCP tools; OSS, not yet at scale. (2) AgentSeal Registry — runtime scoring of 1,808 MCP servers, 4.2% false-positive rate, refreshed daily.

### Compatibility mechanics — how agents check protocol fit

- **Agent Card declares supported transports & auth schemes** (OAuth 2.0, OpenID Connect, mTLS); client refuses if no overlap. UCP extends this with payment handler matching.
- **Server evaluations** (mcp-agent docs.mcp-agent.com): connect MCP server to reference agent, verify tool firing/error handling/latency budget; LLM judges qualitative outputs.
- **Two real implementations:** (1) Cisco open-source A2A Scanner (blogs.cisco.com/ai/securing-ai-agents-with-ciscos-open-source-a2a-scanner). (2) Microsoft's Agent Governance Toolkit — a control-plane shim between MCP client and tool servers, evaluating each call against policy.

### Commerce mechanics — A2A2A chains

- **Stripe SPT example chain:** consumer agent → checkout agent → SPT issued (scoped, capped, time-bounded) → SPT redeemed at merchant of record → settlement on Stripe → refund/dispute follows standard Stripe behavior (`subsequent events behave as if you provided the PaymentMethod directly`). Webhooks: `shared_payment.granted_token.deactivated`.
- **x402 chain:** client GET → server returns 402 with payment terms → client signs USDC tx → retries with X-PAYMENT header → facilitator verifies on-chain settlement → server returns resource. Sub-2-second settlement; ~$0.0001 fees.
- **A2A2A insurance claim (qualitative; no production-disclosed chain found):** Search yielded only generic A2A bank-transfer insurance flows (Dwolla/Stripe blog content) and academic multi-hop trust papers. The "claim → adjuster agent → payment agent" production case is **NOT verifiable** from public sources as of May 2026 — flagged in Gaps Remaining.

## Phase 3: Failure Modes

**1. Tool poisoning / prompt injection in MCP descriptions.** Up to **84% attack success rate** on agentic AI coding editors via poisoned config rule files (arXiv 2509.22040 "Your AI, My Shell"). Microsoft Copilot Studio prompt injection (CVE 2026-XXXX, VentureBeat reporting) exfiltrated data even after the patch. Mitigation: indirect-injection defenses (Microsoft developer blog), strict tool-description sanitization, OWASP MCP Top 10 (MCP04 supply chain, MCP07 prompt injection), AgentSeal-style runtime validation. Confidence: **HIGH**.

**2. Supply-chain malicious package (postmark-mcp).** First publicly documented malicious MCP server: 15 clean versions (1.0.0–1.0.15) built trust, then 1.0.16 added one line BCC'ing every outgoing email. ~1,500 weekly downloads at discovery; ~300 organizations integrated. **9 of 11 MCP registries successfully poisoned** with malicious trial balloons (PipeLab State of MCP Security 2026). Mitigation: SBOM per server, hash-pinning, version-diff monitoring, third-party scanning (AgentSeal, Enkrypt). Confidence: **HIGH**.

**3. RCE via inadequate stdio sanitization.** OX Security advisory: 7+ critical/high CVEs across GPT Researcher (CVE-2025-65720), LiteLLM (CVE-2026-30623), Agent Zero (CVE-2026-30624), Upsonic (CVE-2026-30625), Flowise (CVE-2026-40933), Windsurf (CVE-2026-30615 — zero user-interaction RCE), DocsGPT (CVE-2026-26015). **150M+ downloads, 200K servers exposed.** Vendors "disregarded findings as expected behavior" in some cases. Mitigation: input validation, least-privilege MCP processes, OWASP MCP Top 10 enforcement. Confidence: **HIGH**.

**4. Cross-agent credential leakage in multi-hop A2A chains.** "In-band credential exchange can allow credentials to be passed across chains of multiple A2A agents, exposing those credentials to each agent participating in the chain" (developers.redhat.com). One compromised agent in a 50-agent system can trigger system-wide failures within minutes (eprint.iacr.org/2026/497.pdf — "Trust in Agent Networks Must Be Baked In, Not Bolted On"). Mitigation: per-hop credential issuance (DPoP-style), zero-trust between agents, capability-scoped tokens, mTLS at every boundary. Confidence: **HIGH**.

**5. Cascading injection across trust boundaries.** Multi-agent systems amplify single-agent vulnerabilities — pipeline architectures propagate injections linearly; orchestrator hub-and-spoke creates blast-radius failures. "Multi-agent frameworks lack inter-agent sanitization, treating all agent-to-agent communication as trusted" (redteams.ai). Mitigation: A2A scanners (Cisco open-source), policy-as-code at agent boundaries, per-message provenance tracking. Confidence: **HIGH**.

**6. Protocol churn — 4 breaking spec revisions in 18 months.** MCP versioning is `YYYY-MM-DD` with no semver semantics; batching feature added 2025-03-26, removed 2025-06-18; SEP-1400 currently proposing semver migration. Pieter Levels: "useless"; Garry Tan: "MCP sucks honestly"; Perplexity CTO publicly moved off MCP internally; "MCP is dead, long live the CLI" reached HN front page. Mitigation: pinned protocol versions, capability discovery negotiation, runtime feature-flag detection. Confidence: **HIGH**.

**7. Stale and shadow MCP servers.** "The ecosystem is moving fast enough that any snapshot will be partly stale within six months" (PipeLab). Shadow MCP servers (deployed without IT oversight) are invisible by default and degrade with age. Strata.io documents that MCP can be bypassed entirely via direct API, headless browsers, or shadow connectors — losing intent, policy enforcement, and audit. Mitigation: enterprise discovery scanning, ingress proxies that enforce MCP routing, periodic registry re-scoring. Confidence: **HIGH**.

**8. Agent quality inequality invisible to user (Project Deal finding).** Anthropic's Project Deal (April 2026, 69 employees, 186 deals, ~$4K): users with weaker Haiku models lost ~$2.45/item as buyer and ~$2.68/item as seller vs Opus, but **rated fairness identically (4.05 vs 4.06 on 7-point scale)**. Implication: in a real A2A marketplace, weaker agents lose money silently. Mitigation: trust labeling, model attestations in Agent Cards, third-party benchmarks. Confidence: **HIGH** — primary source.

**9. Agent confabulation and accidental purchases.** Project Deal reported one participant accidentally buying a duplicate snowboard already owned; agents confabulated personal stories during negotiation when role-playing as humans. Mitigation: AP2 Cart Mandates (explicit human authorization), inventory-aware constraints, dual-control on irreversible purchases. Confidence: **HIGH**.

**10. Refund and dispute paths under-specified for x402.** Stripe MPP inherits standard Stripe dispute machinery (chargebacks routed to seller's Stripe balance); x402 has zero native dispute primitive — settlement is final on-chain. Real reconciliation depends on out-of-band agreements between agent operators. Mitigation: AP2 Payment Mandates as audit evidence; escrow facilitators; buyer-protection layers built on top. Confidence: **MEDIUM** (mechanics clear; production dispute case studies not yet disclosed).

**Stop condition exceeded:** 10 failure modes documented.

## Phase 4: Contrarian

### Counter-argument 1 — Foundation models are absorbing the primitives directly

**Strongest case the bet is wrong.** OpenAI's Apps SDK launched a directory inside ChatGPT (developers.openai.com/apps-sdk); approved apps appear in the ChatGPT app store and Codex. Anthropic ran Project Deal (April 2026), an internal end-to-end agent marketplace where 69 employees did 186 deals worth $4K with **zero human intervention**. Shopify+Google's Universal Commerce Protocol (March 2026) folds discovery + payment + identity into a protocol owned jointly by the two largest commerce surfaces. Google plans up to **$40B investment in Anthropic** (HN 47892074), tightening the Google-Anthropic axis around AP2+A2A+UCP.

**Concrete evidence:** Shopify Agentic Storefronts gives merchants ChatGPT/Copilot/Perplexity/Gemini distribution from one admin checkbox. The "Google My Business for agents" surface area shrinks every quarter that Shopify, Google, OpenAI, and Anthropic ship vertical integration. Digitalcommerce360 reports "Anthropic, OpenAI, and Google are each doing in agentic commerce" all three building proprietary commerce paths.

**Why it might still be wrong (defending the original bet):** Foundation models cover at-scale e-commerce verticals (Shopify owns physical goods) but not long-tail local services — the pizza shop, the plumber, the immigration paralegal in São Paulo. These categories are where Shopify Agentic Storefronts doesn't help and where agent-discoverable presence still requires writing an MCP server today. Confidence in the contrarian: **MEDIUM-HIGH**.

### Counter-argument 2 — Agents will self-build connections at runtime by reading docs

**The argument:** Cloudflare's Project Think and Anthropic's Code Execution with MCP show that **2,000 tokens of code beats 150,000 tokens of pre-loaded tool definitions (98.7% reduction)** and **1,000 tokens of search/execute beats 1.17M tokens of tool-per-endpoint (99.9% reduction)**. If runtime is that cheap, why need a registry at all? The agent reads OpenAPI specs, scrapes a Stripe doc page, and writes its own connector. Hacker News critique (sshh.io "Everything wrong with MCP"; "MCP is dead, long live the CLI"): "All you need is an HTTP client with authorization for endpoints."

**Concrete evidence:** "Self-authored extensions include agents that write their own tools at runtime" (LangChain runtime blog); Strata.io confirms MCP can be bypassed via direct API, headless browsers, shadow connectors. AnyAPI / OpenAPI 3.x is rich enough that strong models (Claude Sonnet 4.5+, GPT-5+) can write a working connector from a docs URL in a single call.

**Why it might still be wrong:** (a) Runtime self-build does not solve trust — the registry is also the reputation surface; an agent that reads docs cannot tell a real plumber from a scam shop. (b) AgentSeal's data (66% of MCP servers have findings, 12.9% high-trust) shows scoring infrastructure is necessary precisely because servers are untrusted by default. (c) A non-developer publisher cannot publish "OpenAPI + auth" — the bar is still too high. (d) Cloudflare's own success with `search() + execute()` is *itself* a registry-style abstraction — they replaced one tool registry with another, not "no registry." Confidence in the contrarian: **MEDIUM**.

### Counter-argument 3 (bonus) — Protocol churn makes any platform bet premature

**The argument:** 4 MCP spec revisions in 18 months, breaking changes every ~3 months, 200K+ servers exposed to one design flaw, OWASP just published an MCP Top 10. Building a non-developer publishing layer on top of MCP/A2A in 2026 means rebuilding it in 2027 and 2028. Hacker News thread 47380270 ("MCP is dead; long live MCP"). Production MCP servers fail reliability stress tests at high rates (digitalapplied.com 100-server stress test).

**Why it might still be wrong:** UCP (March 2026) appears to be the convergence — Shopify, Google, Stripe, Visa, Mastercard, Walmart all pinned to one stack. The protocol churn argument was strongest in 2025; in 2026 the bets are placed.

**Stop condition met:** 2 substantive counter-arguments with concrete evidence (3 documented).

## Source Registry

| URL | Title | Credibility (1–5) | Recency | Type |
|---|---|---|---|---|
| stripe.com/blog/machine-payments-protocol | Introducing the Machine Payments Protocol | 5 | Mar 2026 | Primary |
| docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens | Shared Payment Tokens | 5 | 2026 | Primary |
| docs.cdp.coinbase.com/x402/welcome | x402 Welcome | 5 | 2026 | Primary |
| coinbase.com/developer-platform/discover/launches/x402 | Coinbase x402 launch | 5 | 2026 | Primary |
| coinbase.com/blog/coinbase-and-cloudflare-will-launch-x402-foundation | x402 Foundation | 5 | 2026 | Primary |
| cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol | Announcing AP2 | 5 | 2025 | Primary |
| ap2-protocol.org/specification | AP2 Specification | 5 | 2026 | Primary |
| agentpaymentsprotocol.info | AP2 docs | 5 | 2026 | Primary |
| a2a-protocol.org/v0.3.0/specification | A2A Specification | 5 | 2026 | Primary |
| github.com/a2aproject/A2A | A2A GitHub | 5 | 2026 | Primary |
| modelcontextprotocol.io/specification/versioning | MCP versioning | 5 | 2026 | Primary |
| developers.openai.com/apps-sdk | OpenAI Apps SDK | 5 | 2026 | Primary |
| openai.com/index/introducing-apps-in-chatgpt | OpenAI Apps in ChatGPT | 5 | 2025-2026 | Primary |
| anthropic.com/features/project-deal | Project Deal results | 5 | Apr 2026 | Primary |
| anthropic.com/engineering/code-execution-with-mcp | Code Execution with MCP | 5 | 2026 | Primary |
| shopify.engineering/ucp | Building UCP | 5 | Mar 2026 | Primary |
| developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp | UCP under the hood | 5 | 2026 | Primary |
| shopify.com/news/winter-26-edition-agentic-storefronts | Agentic Storefronts launch | 5 | 2026 | Primary |
| shopify.com/news/ai-commerce-at-scale | AI commerce at scale | 5 | 2026 | Primary |
| help.shopify.com/en/manual/online-sales-channels/agentic-storefronts | Shopify Agentic Storefronts | 5 | 2026 | Primary |
| blog.cloudflare.com/project-think | Project Think | 5 | 2026 | Primary |
| developers.redhat.com/articles/2025/08/19/how-enhance-agent2agent-security | Red Hat A2A security | 4 | Aug 2025 | Primary |
| aws.amazon.com/blogs/opensource/open-protocols-for-agent-interoperability-part-4-inter-agent-communication-on-a2a | AWS A2A | 4 | 2026 | Primary |
| docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a-protocol-contract.html | Bedrock AgentCore A2A | 5 | 2026 | Primary |
| agentseal.org/blog/mcp-server-security-findings | 1,808 servers / 66% findings | 4 | 2026 | Primary |
| agentseal.org/blog/runtime-exploitation-mcp-servers | Runtime Exploitation | 4 | 2026 | Primary |
| github.com/AgentSeal/awesome-mcp-security | AgentSeal repo | 4 | 2026 | Primary |
| github.com/gigabrainobserver/mcp-scorecard | MCP Scorecard | 4 | 2026 | Primary |
| ox.security/blog/mcp-supply-chain-advisory-rce-vulnerabilities-across-the-ai-ecosystem | OX Security advisory | 4 | 2026 | Primary |
| pipelab.org/blog/state-of-mcp-security-2026 | State of MCP Security 2026 | 4 | 2026 | Secondary |
| zuplo.com/mcp-report | Zuplo State of MCP | 4 | 2026 | Secondary |
| mcpmanager.ai/blog/mcp-adoption-statistics | MCP Adoption Statistics | 3 | 2026 | Secondary |
| pulsemcp.com/statistics | PulseMCP Statistics | 4 | 2026 | Primary |
| arxiv.org/abs/2505.02279 | Survey of agent interop protocols | 4 | 2025 | Primary |
| arxiv.org/html/2511.02841v1 | DIDs + VCs for agents | 4 | 2025 | Primary |
| arxiv.org/html/2509.22040v1 | Your AI My Shell — 84% prompt injection | 4 | 2025 | Primary |
| arxiv.org/abs/2603.22489 | MCP threat modeling | 4 | 2026 | Primary |
| eprint.iacr.org/2026/497.pdf | Trust in Agent Networks | 4 | 2026 | Primary |
| datatracker.ietf.org/doc/html/draft-stone-atep-00 | ATEP IETF draft | 4 | 2025 | Primary |
| datatracker.ietf.org/doc/draft-nandakumar-agent-sd-jwt | SD-JWT Agent Cards | 4 | 2025 | Primary |
| github.com/vinaybhosle/agentstamp | AgentStamp | 3 | 2026 | Primary |
| news.ycombinator.com/item?id=43676771 | Everything Wrong with MCP HN | 3 | 2025 | Opinion |
| news.ycombinator.com/item?id=47380270 | MCP is dead long live MCP | 3 | 2025 | Opinion |
| blog.sshh.io/p/everything-wrong-with-mcp | Everything wrong with MCP | 3 | 2025 | Opinion |
| theregister.com/2026/04/16/anthropic_mcp_design_flaw | Register 200k servers at risk | 4 | Apr 2026 | Secondary |
| thehackernews.com/2026/04/anthropic-mcp-design-vulnerability.html | The Hacker News | 4 | Apr 2026 | Secondary |
| techcrunch.com/2026/04/25/anthropic-created-a-test-marketplace-for-agent-on-agent-commerce | TechCrunch Project Deal | 4 | Apr 2026 | Secondary |
| pymnts.com/visa/2026/visa-scales-agentic-commerce-through-stripe-protocol-collaboration | Visa + Stripe | 4 | 2026 | Secondary |
| strata.io/blog/agentic-identity/prevent-mcp-bypass | Prevent MCP Bypass | 3 | 2025 | Opinion |
| docs.mcp-agent.com/test-evaluate/server-evaluation | mcp-agent server evaluation | 4 | 2026 | Primary |

## Confidence Matrix

| Finding | Confidence | Supporting evidence | Counter-evidence |
|---|---|---|---|
| MCP discovery surface is developer-only | HIGH | Smithery/Glama/MCPfinder all require server authoring | Shopify Agentic Storefronts removes the requirement for goods commerce |
| 78% of enterprise AI teams have MCP in production (Apr 2026) | HIGH | Zuplo State of MCP report; mcpmanager.ai stats | Self-reported survey, possible selection bias |
| 150+ orgs have A2A in production routing real traffic | HIGH | Agentic AI Foundation Apr 2026 status; rapidclaw.dev | Number not independently audited |
| Stripe MPP+SPT is live with named partners | HIGH | stripe.com primary blog, docs.stripe.com | "Live" partners (PostalForm, Prospect Butcher) are small |
| x402 has $50M+ cumulative volume | HIGH | Multiple secondary sources concur on the figure | Self-reported by Coinbase ecosystem |
| 66% of 1,808 MCP servers have security findings | HIGH | AgentSeal published methodology + FP rate | One vendor; Snyk's 36% on agent skills is a different population |
| 84% prompt injection success against agentic IDEs | HIGH | arXiv 2509.22040 peer-reviewable | Specific to coding editors, not all MCP usage |
| Foundation models are absorbing primitives | MEDIUM-HIGH | OpenAI Apps SDK directory; Anthropic Project Deal; UCP partnership; $40B Google→Anthropic | Long-tail local services not yet covered |
| Agents can self-build at runtime cheaply | MEDIUM | Cloudflare 99.9% reduction, Anthropic 98.7% reduction | Self-build doesn't solve trust/reputation gap |
| 4 MCP breaking revisions in 18 months destabilize platform bets | HIGH | modelcontextprotocol.io versioning page; SEP-1400 | UCP March 2026 may have ended the churn |
| Multi-hop A2A2A insurance chain in production | LOW | Generic A2A bank-payment material only | No disclosed end-to-end claim chain found |
| AP2 dispute mechanics solved | MEDIUM | Mandates create audit trails | x402 has no native dispute primitive |
| Project Deal shows agents complete real deals autonomously | HIGH | Anthropic primary source: 186 deals, $4K, zero human intervention | Internal-only; participants self-selected |

## Gaps Remaining

**Phase 1 — Landscape**
- Apple's role in agent commerce primitives is not visible in public sources; speculation that Apple Pay + private-cloud-compute could absorb both trust + commerce, but no announced product as of May 2026.
- Adoption numbers for non-Shopify agentic storefronts (Square, Wix, BigCommerce) are not disclosed — unclear how non-Shopify long-tail is being covered.

**Phase 2 — Mechanics**
- The "insurance claim → adjuster agent → payment agent" canonical multi-hop A2A2A example does not have a disclosed production implementation visible in 2026 public sources. Generic Dwolla/Stripe insurance content is bank-A2A (account-to-account), not agent-to-agent. **This is the cleanest gap in the brief — the canonical multi-hop A2A example is aspirational, not yet a verified production case.**
- Programmable spend limits across multi-hop chains: SPT caps and AP2 mandates handle single-hop, but cross-platform chained spend caps (e.g., consumer agent → travel agent → hotel agent → room-service agent) lack a documented unified primitive.

**Phase 3 — Failure Modes**
- Real refund/dispute case studies on x402 have not been published; mechanics are clear (settlement is final on-chain) but production reconciliation patterns are private to ecosystem participants.
- mTLS certificate rotation across cross-org agent fleets at scale: the failure mode is acknowledged in IETF drafts but no published incident report.

**Phase 4 — Contrarian**
- The strongest contrarian argument I could not fully verify: whether Anthropic's $40B Google investment + UCP convergence functionally closes the window for an independent "Google My Business for agents" before 2027. Project Deal evidence is the strongest data point but is internal-only and not yet at consumer scale.
- Whether non-developers actually want agent-discoverable presence (demand-side question) — searches yielded no consumer/SMB survey data on whether long-tail providers see agent traffic as a revenue channel today.

---

_Total ~5,000 words. ~22 web searches across 3 rounds; 10 primary-source WebFetches verifying critical numbers (Stripe MPP, AP2 spec, Project Deal, AgentSeal findings, OX advisory CVEs, Anthropic code-execution token math, Shopify UCP/Agentic Storefronts, HN MCP critique). Stop conditions met for all 4 phases._
