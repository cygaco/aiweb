# Module 3: Conversational Pathways (Deep Dive)

## Lesson 1: Nodes — The Building Blocks

### What Is a Node?
"Fundamental building block of conversational pathways. Each node represents an action point during the call or instructional information available to your agent."

### What Is a Pathway?
Flow chart instructions agents follow during conversations. Built from interconnected nodes that guide decision-making. Agent starts at the first node and decides which pathway to take to move to the next one.

---

### Node Types

| Node Type | Purpose / Notes |
|---|---|
| **Default** | Executes prompts. Toggle "Static Text" for fixed/scripted responses instead of LLM-generated ones. |
| **Transfer Call** | Routes calls to different phone numbers (human lines, support departments, other pathways). |
| **End Call** | Terminates the pathway with an agent-spoken closing message. |
| **Knowledge Base** | Stores text blocks the agent can access during calls. Future support planned for PDFs and vector databases. |
| **Wait for Response** | Like Default but includes holding/response delay capability — agent waits for user to respond. |
| **Webhook** | Executes webhooks mid-conversation. Agent can speak during or after the webhook request. |

---

### Global Nodes

Nodes accessible from **every other node** in a pathway without explicit connections. After execution, agents automatically return to their previous node unless "Enable Forwarding" is toggled.

**Three operational modes for Global Nodes:**
1. Auto-return to previous node after execution (default)
2. Create a label/pathway back to the triggering node explicitly
3. Redirect to another specific node (ignores node prompts)

**Best use:** Catch-all escalation handlers, purchase-readiness checks, FAQ interrupts — anything that can occur at any point in the conversation.

---

### Global Prompts

Apply context across all nodes without manual repetition in each node. Should "indicate the personality of the agent — how it should communicate" rather than define conversation content itself.

**Do:** Set tone, communication style, agent persona here  
**Don't:** Put order flow or conversation script in global prompts

---

### Variable Extraction

A separate LLM (the Data Extraction Model) analyzes responses to extract variables.

**Best practice:** Write "fully descriptive prompt for each variable to get a more precise extraction value."

**System Variables** (built-in, reference in prompts using `{{ }}`):
- `{{ now_utc }}` — current UTC timestamp

---

### Conditional Routing

Create branching logic based on extracted variables. Use "opposites" as branch labels to avoid ambiguity (e.g., label one branch "User interested" and the other "User NOT interested" — not just "no").

### Looping Conditions

Instruct agents to remain on a node until conditions resolve (e.g., "Stay on this node until all questions are answered"). The agent re-prompts instead of advancing.

---

### Real-World Implementation Pattern (Sales Example)

```
Greeting node
  → Qualification node (yes/no branch)
      → [Yes] Product routing node
            → Knowledge base node (product details)
            → Transfer node (human handoff)
      → [No] End call node
  + Global catch-all node (purchase readiness — accessible from anywhere)
```

---

## Lesson 2: Advanced Pathway Features

### Conditionals & Flow Control

**Pathway labels** express conditions using simple natural language prompts:
- Example: `"User says yes"`

**Pathway descriptions** use verbose 1-shot phrasing:
- Pattern: `"Select THIS PATHWAY IF [condition]"`
- This helps the Navigational Model choose correctly

**Advanced conditions** employ Boolean logic and keyword matching for variable comparisons.

**Loop conditions:** Prompt agents to remain in nodes until specified conditions are met.

---

### Node Configuration Options

| Option | Behavior |
|---|---|
| **Dynamic Interruption Threshold** | Adjusts interruption sensitivity from the current node onward (overrides global setting for that node) |
| **Skip User's Response** | Agent continues to next node without waiting for user input; next node selection based on prior dialogue |
| **Block Interruptions** | Agent ignores user interruptions and completes its full statement before listening |

---

### Variables System

**Reference syntax:** Double curly braces — `{{variable_name}}`

#### Built-in System Variables

| Variable | Value |
|---|---|
| `{{lastUserMessage}}` | User's most recent response (verbatim) |
| `{{prevNodePrompt}}` | Text of the previous node's prompt |
| `{{now_utc}}` | Current UTC timestamp |
| `{{from}}` | Caller's phone number |
| `{{to}}` | Called phone number |
| `{{call_id}}` | Unique identifier for the current call |

#### Variable Extraction Configuration
When defining a variable to extract, specify:
1. **Variable name** — the key to store it under
2. **Type** — `integer`, `string`, or `boolean`
3. **Description** — fully descriptive prompt telling the extraction model what to look for

**Gotcha:** "Slight latency will be introduced" when referencing extracted variables in subsequent nodes. The extraction LLM needs to run before the next node can use the result. Plan your flow to account for this.

---

### Global Nodes (Advanced Detail)

Connected behind-the-scenes to every node — enables pattern interrupts anywhere in the conversation.

**Three modes:**
1. Auto-return to previous node after execution
2. Create label/pathway back to triggering node (explicit edge)
3. Redirect to another node entirely (node's own prompt is ignored — forwarding takes over)

---

### Testing & Debugging

**Chat Testing**
Use the "Chat with Pathway" button to test via messages instead of making a real call. Shows real-time call logs.

**Test inputs allow:**
- Node selection (start from a specific node)
- Variable passing via `request_data` (pre-seed variables for the session)

**Call Log Contents:**
- User speech (verbatim transcript)
- Assistant speech
- Pathway info: which node was active, condition status, which pathway was selected

**Best Practice for Testing:** Type conversationally to simulate real user behavior. Monitor call logs for configuration errors — the logs show exactly which conditions triggered and which pathway was chosen.

---

## Lesson 3: Real-World Case Studies & Integration Patterns

### Architecture: Autonomous Phone Agents

Bland agents are autonomous phone systems designed for industry-specific automation. Key architecture traits:
- Integration-driven workflows using third-party tools (Zapier, webhooks)
- Conditional pathways for decision-based call routing
- Recording and data export capabilities

---

### Integration Methods

| Method | Use Case |
|---|---|
| **Zapier Integration** | Trigger calls automatically based on external system events (e.g., new lease record created) |
| **Webhook Integration** | Send call outcomes back to external systems (e.g., update property management system with renewal/cancellation status) |
| **Spreadsheet Export** | Export extracted call responses (interview answers, order confirmations) to shared analysis tools |
| **PDF/System Data Passing** | Deliver structured data (lease terms, menus, product specs) to agents for real-time Q&A during calls |

---

### Pathway Implementation Patterns

#### Conditional Routing Pattern
```
Trigger event (Zapier/webhook)
  → Agent calls customer
      → Conditional node: "Is customer interested in renewal?"
          → [Yes] → Booking/renewal flow
          → [No/Cancel] → Cancellation flow
      → Post-call webhook → Update CRM/system
```

#### Escalation Pattern (Global Node)
Create a global node to allow easy escalation to a human team at any point:
```
Global node: "Transfer to human team"
  → Triggers on: any mention of complaint, legal issue, or explicit human request
  → Action: Transfer Call node → human agent number
```

#### Data Flow Pattern
```
Integration trigger → Agent call execution → Recording/response capture → System update via webhook
```

---

### Best Practices from Case Studies

1. **Reduce human touchpoints** in repetitive processes — agents handle the full loop
2. **Automate data export** — don't leave call data in Bland; push it to your systems via post-call webhooks
3. **Implement escalation paths** — always have a global node for complex issues that need human handling
4. **Trigger workflows through existing system integrations** — connect to Zapier, webhooks, or direct API calls rather than manual triggering
5. **Pass relevant data into calls** — use `request_data` or `dynamic_data` to give agents the context they need (menu, order details, customer history)
6. **Use recordings** — capture call recordings for quality review and agent fine-tuning

---

### Pizza Ordering Application (Synthesized from All Modules)

**Recommended architecture:**

```
Tool: place_order (MCP)
  → POST /v1/calls
      → pathway_id: pizza-order-pathway
      → request_data: { restaurant_name, order_items, customer_name, address }

Pathway: pizza-order-pathway
  Node 1 (Default): Greeting + state order
    → "Hello, I'd like to place an order for delivery..."
  Node 2 (Wait for Response): Wait for restaurant confirmation / questions
    → Extract: { order_confirmed: boolean, estimated_time: string, order_id: string }
  Node 3 (Conditional):
    → [Confirmed] → Node 4 (End Call, log success)
    → [Problem/Unavailable] → Node 5 (End Call, log failure)
  Node 6 (Global): Handle hold / "please wait" → Wait for Response, return to previous
  
Post-call webhook → MCP check_order_status → parse transcript
```

**Key parameters for outbound restaurant calls:**
- `wait_for_greeting: true` — restaurant staff will answer first
- `interruption_threshold: 100` — balanced; restaurants may speak longer than typical users
- `keywords: ["pepperoni:2", "margherita:2"]` — boost pizza-specific terms in transcription
- `model: "base"` — needed for any transfer capabilities; use turbo only for pure conversation
