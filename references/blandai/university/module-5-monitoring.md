# Module 5: Call Monitoring and Analytics

## Lesson 1: Introduction to Analytics

### Core Principle

"Incorporating live data is essential to maximizing the performance of your call agent." Analytics is a post-deployment requirement, not optional — it's how you move from a working agent to an optimized one.

### Analytics Suite Capabilities

- Campaign performance insights
- Latency and performance metric tracking
- Individual call issue identification
- Infrastructure quality assurance

### Sentiment Analysis — AI-Driven Transcript Analysis

Bland runs structured queries against call transcripts. Query types:

| Type | Example Query | Return Format |
|------|--------------|---------------|
| Boolean | `"Was the client satisfied with the resolution?"` | `true` / `false` |
| String | `"What was the caller's reaction?"` | descriptive text |
| Multi-part | `"Did the customer have to repeat themselves multiple times?"` | varies |

### Results Extraction — Beyond Temporal Metrics

The system can extract outcome-based data:
- Resolution confirmation tracking
- Escalation detection: `"Was the call escalated to live support?"`
- Issue resolution verification

### Analysis Schema — Inbound Calls

**Setup:** Add an analysis schema to inbound call numbers in Bland dashboard settings. Automation then processes transcripts using the defined schema. Results appear in the **"Call Analysis"** tab.

---

## Lesson 2: Call Analytics Deep Dive

### Coverage

Analytics covers all call types: campaigns, individual calls, batch calls, and conversational pathway-driven calls.

### Core Modules

**1. Call Analysis Tab**
- Displays summaries of completed call analysis runs
- Results are determined by the analysis schemas you define in Batch Calls settings or Inbound Phone Numbers settings
- No schema defined = no analysis results

**2. Real Time Logs**
- Live streaming reports from active agents
- Multiple filtering options

### Log Categories

| Category | Trigger | Use |
|----------|---------|-----|
| `Call` | Triggered by and related to agents running live calls | Monitor live agent activity |
| `Queue` | Related to call creation and queuing | Batch operations occur before agent assignment |

### Log Status Types

| Status | Description |
|--------|-------------|
| `Info` | Call status updates and conversational pathway progress |
| `Performance` | Latency and timing metrics; backend operation highlighting |
| `Error` | Variable problems, faulty API webhooks, or pathway completion failures |

### Live Calls Table

Displays all currently active calls in tabular format. Allows real-time monitoring of calls in flight.

### Technical Integration Points to Watch

- API webhook connections — common source of `Error` logs
- Variable handling in pathways — errors surface here
- Backend call processing latency — `Performance` logs

---

## Lesson 3: Pathway Testing

### Testing Interface

Bland provides an interactive testing function within the Pathway editor. You can test:
- Complete pathway from start
- Individual nodes in isolation
- Preference: always start from the beginning for most realistic validation

**Interface components:**
- Live chat box — interact with the agent in real time
- Detailed logs — shows agent decisions and pathway selections at each step

### Pathway Decision Info Box

A real-time display showing:
- Which node the agent is currently on
- Which pathway decision was made
- Extracted variables (and their current values)
- Condition analysis results

### Testing Best Practices

**"Type like you talk"** — use natural language in the chat interface, not formal text. This simulates authentic caller behavior.

### Two Feedback Mechanisms for Refinement

**1. Fine-Tune Decisions**
- When the agent makes an incorrect pathway-routing decision
- Access via the Pathway Decision Info Screen → click "Fine-Tune Decisions"
- Complete the correction dialog to provide the correct routing example
- Adds a fine-tune example to improve future routing

**2. Prompt Optimization**
- When the agent response quality is poor (content, not routing)
- Update the "Node Prompt" in the node editor
- Click "Generate New Response" to test the new prompt under identical conditions
- Iterate — identify the best version, then save it

### Iteration Process

```
Test → Identify Issue → Determine Type (routing vs. response quality)
  → Fine-Tune Decisions (routing) OR Update Node Prompt (quality)
  → Re-test → Save → Deploy
```
