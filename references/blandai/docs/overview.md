# Bland.ai — Platform Overview & Docs Navigation

Source: https://docs.bland.ai/welcome-to-bland

---

## Core Platform Claims
- Sub-second latency for natural-sounding calls
- "Fully self-hosted" — no third-party provider passthrough
- Proprietary transcription, inference, and TTS on optimized V100 GPUs
- Global voice delivery network with edge deployment
- Dedicated instances per customer

## Key Resources

| Resource | URL |
|----------|-----|
| Dashboard | https://app.bland.ai/dashboard/ |
| Send a Call | https://app.bland.ai/dashboard/send-call |
| Phone Numbers (Inbound) | https://app.bland.ai/dashboard/phone-numbers |
| Web Widget | https://app.bland.ai/dashboard/web-widget |
| API Keys | https://app.bland.ai/dashboard/settings |
| University (Starter Guide) | https://university.bland.ai |
| Discord Support | https://discord.gg/QvxDz8zcKe |
| Enterprise Contact | https://forms.default.com/361589 |
| Full API index | https://docs.bland.ai/llms.txt |

## Docs Structure

### Tutorials
- `/tutorials/webhooks` — Webhook setup and payload format
- `/tutorials/personas` — AI Agent persona development
- `/tutorials/batch-calls` — High-volume outbound campaigns

### API Reference
- `/api-v1/post/calls` — Send a call (task-based)
- `/api-v1/post/calls-simple-pathway` — Send a call (pathway-based)
- `/api-v1/get/calls-id` — Get call details and transcript

## Three Core Abstractions

### 1. Prompts / Tasks
Written instructions up to 2,000 characters. Define agent goal, background, and sample dialogue. Simpler but less controllable.

### 2. Conversational Pathways
Flowchart-based call scripts. Full control over every conversation branch. Preferred for production use.

### 3. Personas
Unified AI agent configurations deployable across multiple numbers. Reusable personality/behavior layers.

## Two Models

| Model | Latency | Transfers | IVR | Custom Tools | Best For |
|-------|---------|-----------|-----|-------------|---------|
| `base` | Normal | ✓ | ✓ | ✓ | Production calls with complex flows |
| `turbo` | Minimal | ✗ | ✗ | ✗ | Simple, fast conversations |

**Use `base` for pizza ordering** — IVR navigation needed for phone trees.

## Platform Capabilities Summary
- Outbound call dispatch (single + batch)
- Inbound numbers (monthly subscription per number)
- Real-time API integration during calls (Dynamic Data / Webhook nodes)
- Post-call analysis and transcript extraction
- Voice cloning from short MP3 clip
- Knowledge bases for agent reference
- Secrets management for API credentials
- Batch calls via CSV upload
- Web widget embedding
