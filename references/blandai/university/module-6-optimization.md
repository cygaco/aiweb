# Module 6: Agent Optimization

## Lesson 1: Optimization Framework

### Core Expectation

"There are rarely perfect initial Agents." First-implementation performance will always require iteration. A true enterprise solution has a feedback and improvements loop in place to tweak calls over time — not a one-time configuration.

### Prerequisite

Understand Module 5 (Call Monitoring and Analytics) logging capabilities before optimizing. You need to be able to surface anomalies to know what to fix.

### Goal-Setting Requirement

Before starting optimization, define measurable objectives that are **directly tied to agent performance on calls**. Vague goals don't work.

**Good goal examples:**
- Customer satisfaction score (measured via analysis schema)
- Qualified lead generation rate
- Phone sales conversion rate
- Order confirmation success rate

### Optimization Targets

Three areas to tune:
1. **Pathways** — the conversational flow structure
2. **Prompts** — instructions given to agents at each node
3. **Anomaly fixes** — targeted corrections for identified deviations from expected behavior

---

## Lesson 2: Common Error Types

### Error Type 1: Stuck and Looping Agents

**What it is:** Agent lacks required information and has no alternative route — gets stuck repeating the same response.

**Symptoms:**
- Long transcripts with repetitive, incoherent exchanges
- Call duration significantly exceeds expected average

**Detection methods:**
- Monitor actual call duration against your established baseline average
- Review transcript for repetitive patterns

**Root cause:** Pathway design has no fallback route when agent can't extract required information.

**Fix:** Design pathways with alternative routes. Provide fallback options (e.g., escalate to human, offer to call back).

---

### Error Type 2: Variable Extraction Errors

**What it is:** Agent collects information but in the wrong format, causing downstream API failures.

**Example:** Agent extracts phone number as `555-123-4567` but the API requires `+15551234567`.

**Symptoms:**
- "Bad data" responses from external APIs/webhooks
- Errors visible in Bland `Error` logs
- API returns errors despite the call seeming to go well

**Detection:** API logging — instrument your endpoints to log all incoming payloads.

**Fixes:**
- Specify required format explicitly in the node prompt
- Add validation and format confirmation in prompt design
- Include example dialogues showing correct data collection
- Apply regex-based data cleaning on the receiving API side (defensive coding)

---

### Error Type 3: Unforeseen Conditions

**What it is:** Caller makes a request the pathway wasn't designed to handle. Agent deviates from script.

**Example:** Caller asks about a policy not covered in any node's knowledge base.

**Risk:** When unprepared, agents may deviate significantly from the intended script.

**Detection:** Review transcripts for calls where agent responses seem off-script or confused.

**Fixes:**
- Provide improved fine-tuning dialog examples for affected nodes
- Add knowledge base entries for the unanticipated scenarios
- Implement "graceful uncertainty" protocols — direct users to specialists rather than improvising
- Establish a feedback loop: regularly analyze transcripts for novel questions, then add handling for them

---

## Lesson 3: Systematic Optimization Techniques

### Problem: Stuck and Looping Agents (Detailed)

**Resolution techniques:**
- Review transcripts for repetitive exchange patterns
- Expand knowledge bases with detailed product/service specifications
- Implement multi-step response strategies with conditional checks
- Create fallback mechanisms offering specialist escalation

### Problem: Overly Complex Prompts

**What it is:** A single node prompt tries to collect multiple pieces of information simultaneously. Agent asks multiple questions without pausing for responses.

**Fix:** Break complex instructions into **sequential nodes** instead of monolithic prompt structures. Use loop conditions to ensure complete information collection before advancing.

**Node structure principle:**
- One primary question per node (or use loop conditions if multiple required)
- Conditional branching handles the "did I get everything?" check

### Problem: Variable Extraction Errors (Detailed)

**Full fix approach:**
1. State the required format explicitly at the start of the prompt (e.g., "I'll need your phone number including area code")
2. Implement in-prompt validation — agent confirms format before proceeding
3. Include example dialogues showing correct extraction
4. Apply regex cleaning on API side as a defensive measure

**Example prompt addition:**
```
Collect the customer's phone number. Ask them to provide it with area code, one digit at a time if needed. Confirm the number back to them before proceeding.
```

### Problem: Unforeseen Conditions (Detailed)

**Proactive design:**
- Brainstorm potential customer scenarios during pathway design phase
- Add comprehensive knowledge base entries for likely edge-case questions
- Implement "graceful uncertainty" — route unknowns to a specialist node rather than attempting to answer

**Reactive process:**
- Establish feedback loop: analyze transcripts → identify unanticipated questions → add node/knowledge handling → deploy

### Prompt Structure Requirements

Every agent prompt should include (in order):
1. **Primary goal statement** — what this call must achieve
2. **Specific actionable steps** — 3-5 concrete instructions
3. **Clear success criteria** — how the agent knows the goal is met

Place these at the **beginning of the prompt**, not buried in the middle.

### Context Provision Methods

| Method | When to Use |
|--------|-------------|
| Direct prompt inclusion | Basic context (a few sentences) |
| Knowledge base nodes | Extensive background (policies, full menus, FAQs) |

**Pizza ordering application:** Put the full menu, pricing, and restaurant info in a knowledge base node rather than embedding it all in the main prompt.

### Establishing Baseline Metrics

Before optimization is meaningful, establish baselines:
- Expected average call duration for this use case
- Expected success/conversion rate
- Expected escalation rate

Monitor actuals against these baselines to detect regressions after changes.
