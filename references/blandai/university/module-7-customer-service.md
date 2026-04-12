# Module 7: Enterprise Customer Service Implementation

## Lesson 0: Module Introduction and Architecture Planning

### Core Concept

Before building anything in the Pathways editor, decompose the enterprise problem into caller types and sub-pathways. Don't start coding — start with a caller classification system.

### The Decomposition Method

Break complex telephony solutions into:
1. Identify distinct **caller avatars** (user types)
2. Map each avatar's possible intents to **pathway nodes**
3. Build sub-pathways per avatar
4. Compose into a unified entry point

### Example: Event Venue Phone System

**Three caller avatars:**
1. **Attendees** — event participants
2. **Vendors/Exhibitors** — service providers
3. **Venue Staff/Hosts** — administrators

**Attendee pathway nodes:**
- Purchase tickets to an event
- Get general information on an event

**Vendor pathway nodes:**
- Booth space and scheduling information retrieval
- Support ticket creation for website technical issues
- Prospective vendor identification and sales routing

**Host pathway nodes:**
- Venue information confirmation
- Live event emergency support
- Future event hosting inquiries

### What the Full Build Covers

- Conversational pathway architecture in the Bland editor
- Fine-tuning nodes based on customer data
- Custom tools to interact with external systems (e.g. support ticketing)
- Post-call analysis schemas
- Analytics feedback loop for ongoing troubleshooting

---

## Lesson 1: Building the Pathway Architecture

### Node Types Available

| Node Type | Purpose |
|-----------|---------|
| Default/General | Standard nodes with prompts and variable extraction |
| Knowledge Base | Text repositories of policies, FAQs, terms — agent searches these |
| Transfer Call | Escalate to a live human agent |
| Webhook | Execute API request with extracted data, receive response |

### Variable Extraction in Nodes

Agents capture structured data from the conversation for downstream use:
- Caller name
- Order number
- Vendor ID
- Support PIN
- Any structured field needed by APIs or routing logic

**Reference syntax in prompts:** `{{ variable_name }}`

### Loop Conditions — Critical Pattern

**Problem:** Without loop conditions, if a node needs to collect multiple pieces of information, the agent will likely ask all questions simultaneously and fail to record all answers.

**Solution:** Add a loop condition to the node that checks whether all required variables have been extracted before allowing progression to the next node.

**Rule of thumb:** If a node needs 2+ pieces of information, either:
- Split across multiple sequential nodes (one question per node), or
- Use a loop condition on a single node to enforce complete collection

### Conditional Pathways

Routes conversations based on extracted variable values. Example: a vendor inquiry node evaluates whether the caller wants to **become a new vendor** vs. **request standard vendor info** — routes to different sub-pathways accordingly.

**Conditions can evaluate:**
- Boolean extracted variables
- String values from extraction
- Call context and conversation state

### Knowledge Base Nodes

- Store policies, terms, FAQs as text
- Agent queries the knowledge base to answer questions without hardcoding all answers into prompts
- Best for: frequently asked questions, product/menu info, policies that change, extensive content

**Pizza ordering application:** Store the full menu, pricing tiers, and restaurant-specific policies in knowledge base nodes.

### Webhook Nodes

- Execute API requests using extracted variables
- Example: create a support ticket using caller's name, vendor ID, and issue description
- Support "Send Speech During Webhook" — agent tells caller what's happening while waiting for API response (e.g., "I'm creating your ticket now, one moment.")
- The webhook response can return data the agent uses in subsequent turns

### First Draft Principle

Design your first pathway as a draft. It will require iterative refinement through testing. Don't aim for perfection on the first build — aim for functional coverage of the core flows.

---

## Lesson 2: Fine-Tuning Nodes

### Purpose of Fine-Tuning

Adding examples to teach the agent what successful conversation patterns look like. More examples = better agent performance at directing conversations and matching intended style.

### Three Fine-Tuning Example Types

| Type | Purpose | When to Use |
|------|---------|-------------|
| **Dialog Examples** | Demonstrate expected assistant responses | Improve response quality and tone |
| **Pathway Examples** | Show when to select specific next pathways | Improve routing decisions |
| **Condition Examples** | Teach condition evaluation (variables, call state) | Improve conditional logic |

### Pathway Examples — Detail

Help the routing LLM see when it should select a specific next pathway. Particularly valuable when multiple routing options exist and the distinction between them is subtle.

**Example for caller type classification node:**

Pathway examples map conversational patterns to target classifications:
- `"I need to buy tickets"` → Attendee pathway
- `"I have a booth at the event"` → Vendor pathway
- `"I'm calling about hosting a future event"` → Host pathway

### Condition Examples — Detail

Reference pathway states such as:
- Extracted boolean variables (`order_confirmed: true`)
- Prompt-describing the call context
- Example: customer satisfaction assessment influencing next node selection

### Dialog Examples — Detail

Show the agent what its response should look like:
- `"Ok, it sounds like you are an attendee. Let me help you with that."`
- `"Got it, you're a vendor — I'll pull up your booth information."`
- `"I'll transfer you to our host services team."`

### Recommended Volume

- Target approximately **10 nodes** with fine-tune examples for a typical build
- Complex implementations may need more
- Simpler builds may need fewer

### Feedback Loop for Fine-Tuning

1. Review transcriptions and call logs after deployment
2. Identify ideal exchanges (where agent did the right thing)
3. Add those exchanges as fine-tune examples to the relevant nodes
4. Review failed exchanges — add corrective examples

### Prompt Engineering vs. Fine-Tuning Priority

**Prompt engineering should always come first.** Only add fine-tune examples after you've confirmed the prompt itself is well-structured. Fine-tuning is for edge cases and consistency improvement, not fixing fundamentally broken prompts.

---

## Lesson 3: Post-Call Analysis and Debugging (Call Logs)

### Call Logs Screen

Accessible from Bland dashboard. Each call record includes:

| Field | Description |
|-------|-------------|
| Duration | Call length in seconds/minutes |
| Timestamp | When the call occurred |
| AI-generated summary | Bland's automatic call summary |
| Complete transcript | Full conversation text |
| Extracted variables | All variables captured during the call |
| Error messages | Any errors that occurred |
| Associated costs | Credit cost for this call |

### Analysis Schema

An automated extraction mechanism that directs Bland to automatically extract structured answers about how each call went. The schema is a set of questions run against the completed transcript.

**Configuration location for inbound Pathway calls:**
```
Bland Dashboard → Phone Numbers → Use Number → Analysis Schema
```

**Schema question format:**
```json
[
  ["Did the caller confirm their order?", "boolean"],
  ["What items were ordered?", "string"],
  ["Was the call answered by a human or machine?", "human or voicemail"],
  ["Was there any issue with the call?", "boolean"]
]
```

**Answer type options:** `"boolean"`, `"string"`, `"human or voicemail"`, any descriptive type. Unanswerable questions return `null`.

### Manual Transcript Review

Best practice: manually read transcripts, especially early in deployment.

**What to look for:**
- Edge cases the agent didn't handle well
- Scenarios not covered by any node
- Agent responses that went off-script

**Action from transcript review:**
- Identify ideal exchanges → add as fine-tune dialog examples
- Identify gaps → add knowledge base entries or new nodes
- Identify misrouting → add pathway fine-tune examples

---

## Lesson 4: Testing, Iteration, and Deployment

### Test Pathway Feature

Bland provides an in-editor simulation for testing complete pathways or individual nodes before going live.

**Testing interface:**
- Left side: chat box for simulating caller input
- Right side: detailed conversation log showing:
  - Current node
  - Updated list of extracted variables (live, as they're captured)
  - Pathway Decision Info — which route was selected and why

### Variable Tracking During Tests

The log shows variables being extracted in real time. Example: when a caller states their name, the log updates to show `name: "Alice"` immediately.

### Common Configuration Mistake

**Static Text vs. Prompt mode:** A node set to "Static Text" mode will output the raw prompt text verbatim to the caller. Always verify nodes are in **Prompt mode** (not Static Text) unless you explicitly want verbatim output.

### Iteration Priority Order

```
1. Fix prompt (prompt engineering)
2. Add/improve fine-tune examples
3. Restructure pathway nodes
4. Add knowledge base content
```

**The majority of agent updates come at the prompt level first.** Don't jump to structural changes before exhausting prompt-level fixes.

### Testing Methodology

- Simulate realistic caller scenarios, including edge cases
- Test the "happy path" AND every branch condition
- Test with ambiguous inputs that could match multiple pathways
- Test with malformed data (wrong format phone numbers, partial information)
- Verify all webhook calls fire correctly and return expected data
- Check all extracted variables are captured correctly before production deployment
