# Bland.ai — Platform Overview

Source: https://www.bland.ai/

---

## Headline Metrics
- **65%+ FCR** (first-call resolution) across deployments
- **Live in 30 days** from kickoff to production-grade agents
- **$100s of millions saved** annually in customer cost reduction
- Millions of calls automated without human agents

---

## Three Core Building Blocks

### 1. Personas
Unified AI agents deployable across multiple phone numbers and use cases from a single build. Configures personality, voice, and behavioral guardrails.

### 2. Pathways
Visual conversation design tool. Maps every call step from greeting through information collection, API calls, and human transfers. Full conditional logic and branching.

### 3. Voices
- Pre-built library of voices
- **Custom voice cloning from a single short MP3** — no fine-tuning required
- Emotional control via in-context markers: `<excited>`, `<calm>`, etc.
- Multi-voice blending support

---

## Deployment Options

| Method | Description |
|--------|-------------|
| API | POST to Bland's `/calls` endpoint |
| Dashboard | Browser-based send call UI |
| Batch / CSV | Upload list, dispatch thousands simultaneously |
| SIP | Configure via SIP with auto-discovery and test call |
| Web Widget | Embed calling widget on website |
| Zapier | No-code integration |

---

## Infrastructure

- **Self-hosted** — no audio routed through third parties (OpenAI, Deepgram, etc.)
- Proprietary STT, LLM inference, and TTS on optimized **V100 GPUs**
- **Global voice delivery network** — edge deployment for lowest latency
- **Unlimited concurrency** — thousands of simultaneous calls
- Dedicated instances per customer
- On-premise or VPC deployment available (enterprise)

---

## Monitoring & Analytics

- Real-time call visibility and recording
- Live pathway decision logs during active calls
- Sentiment analysis scoring
- Citation extraction from transcripts
- Outcome data transformation via custom JavaScript
- Analysis schemas for structured post-call data extraction
- Compliance guardrails with real-time monitoring
- Human handoff triggers

---

## Integration Ecosystem

Native integrations:
- **CRM**: Salesforce, HubSpot
- **Contact Center**: NICE, Five9, Amazon Connect, Vonage
- **Communication**: Twilio, Slack
- **Scheduling**: Calendly
- **Automation**: Zapier
- **Telephony**: SIP

---

## Pricing Model

No public pricing. Enterprise: dedicated solutions engineer, custom contract.
Self-serve (from Module 4): `$0.003` per call + `$0.0015` per minute.

---

## Security
- Complete data isolation — no third-party provider passthrough
- Secrets management for API credentials within pathways
- Guard rails for compliance (TCPA disclosures, custom constraints)
