# Module 2: Basic Operations

## Lesson 1: Making Calls via API

### Two Call Methods
1. Bland Dashboard (browser-based)
2. API (code, Postman, or Zapier integration)

### API Request Structure

**Request Type:** POST

**Headers Required:**
```
Authorization: <your-api-key>
Content-Type: application/json
```

**Request Body (JSON) — Minimum Required Fields:**
```json
{
  "phone_number": "+12223334444",
  "task": "Your prompt/instructions for the agent",
  "language": "en"
}
```

**Response:** Success confirmation with call_id

### Agent Requirements for Calls
- Target phone number
- Prompt with instructions (the "task")
- Language specification

### Prompt Best Practices

**Essential Components of a Good Prompt:**
1. A clear "goal" — the objective of the call
2. Necessary background information (agent identity, context about who they're calling)
3. Sample conversation demonstrating expected behavior

**Technical Guidelines:**
- Keep under 2,000 characters
- Use simple, direct language
- Frame instructions positively ("Do this" vs. "Don't do this")
- Label speakers consistently: Agent as "You", recipient as "Person"
- Include example transcripts to improve model understanding

**Quality Tip:** Experiment with different example transcripts in your prompts to improve results.

### Key Features Available
- **Agent Testing** — live behavior simulation before deployment
- **Conversational Pathways** — complex conditional logic (recommended over simple prompts for multi-step flows)
- **Vector Stores** — knowledge base integration
- **Full API documentation** — all endpoints at docs.bland.ai

---

## Lesson 2: Knowledge Bases

### What Is a Knowledge Base?
"Data converted to numbers so that a machine (like our Agent) can read it." Functions as a reference library agents consult during calls.

### Why Knowledge Bases Exist
**Prompt length limitation:** Prompts should stay under 2,000 words for optimal performance. Knowledge bases let agents access expansive information without embedding it directly in prompts.

### Automatic Search Behavior
Agents autonomously search knowledge bases when they determine additional information is necessary to respond to queries. No explicit instruction needed — the agent self-triggers retrieval.

### API Operations

**Create / Update Knowledge Base** — POST  
**Retrieve Knowledge Base or List All** — GET  
**Remove Knowledge Base** — POST (delete endpoint)

Full endpoint specifications at: Bland documentation → Knowledge Learn File endpoint reference

### Use Case Example
Sales agents access comprehensive product details (features, benefits, pricing) during prospective client conversations — improving response accuracy without needing to embed all that data in the prompt.

### Pizza Ordering Application
A knowledge base can hold the full restaurant menu, pricing, and available toppings. The agent auto-retrieves relevant menu items when a customer asks about options, keeping the main prompt focused on the order flow.

---

## Lesson 3: Conversational Pathways (API)

### What Are Conversational Pathways?
Flowchart-like structures that enable agents to navigate through conversation nodes sequentially until reaching a termination point. Greater dialog control compared to simple prompt endpoints.

### Architecture
Agents operate via nodes. "The agent starts at the first node and then decides on a pathway to take to move on to the next one."

### Key Features
- **External API Integration** — web searches and external calls within the flow
- **Knowledge Base Integration** — vector stores can be incorporated into nodes
- **Response-Based Decision Making** — dynamic routing based on user inputs
- **Webhook Execution** — trigger webhooks at conversation points with speech output capability
- **Call Termination Control** — specify conditions for ending calls and agent disconnection

### Conditions Mechanism
Conditions enforce prerequisites before node transitions. "The agent will stay on the node until the user provides the required information." If users deviate, the agent re-prompts for compliance with established conditions.

### API Operations
- **GET** — Retrieve pathway information
- **POST** — Create and update pathways
- **DELETE** — Remove pathways

### Example: Reservation System with Conditional Routing
A reservation node evaluates guest count:
- `< 8 guests` → proceed to booking node
- `>= 8 guests` → route to call transfer node

### Key Distinction from Simple Prompts
Conversational Pathways offer "Greater Dialog Control" — enable instruction-based response handling (prompts or fixed sentences) at each step rather than letting the LLM decide everything from one large prompt.

---

## Lesson 4: Phone Number Management (Inbound & Outbound)

### Number Types

**Inbound Numbers**
Phone numbers customers call to initiate conversations with AI agents. Offered on monthly subscription basis per number. Become active immediately upon creation.

**Outbound Numbers**
Used by agents to initiate calls.

---

### API: Creating Inbound Phone Numbers (POST)

#### Request Parameters

| Parameter | Type | Description |
|---|---|---|
| `area_code` | String | Three-digit area code; enables exact match purchasing if specified |
| `country_code` | String | "US" or "CA"; contact support for other countries |
| `phone_number` | String | Exact number override (format: `"+12223334444"`); supersedes `area_code` |
| `prompt` | String | Defines AI conversation start, available info, and behaviors |
| `webhook` | URL | HTTP/HTTPS callback receiving `call_id` and transcript upon call completion |

#### Response
Generated phone number, active immediately for receiving calls.

---

### API: Configuring Inbound Numbers (POST)

#### All Configuration Parameters

| Parameter | Type | Description |
|---|---|---|
| `pathway_id` | String | **Most commonly used.** Specifies a Conversational Pathway for the agent. Overrides all prompt-related settings. |
| `prompt` | String | Instructions, context, conversation flow examples. Overridden if `pathway_id` is set. |
| `first_sentence` | String | Specific opening phrase the agent speaks first. Overridden by `pathway_id`. |
| `wait_for_greeting` | Boolean | Defaults to `false` (agent speaks immediately). Set `true` to wait for caller to greet first. |
| `interruption_threshold` | Integer | Recommended range: 50–200, start at 100. Lower = quicker agent responses; higher = agent waits longer before responding. Tune in 10-unit increments. |
| `model` | String | Selects Bland model variant (`"base"` or `"turbo"`). |
| `voice` | String | Sets agent's voice. |
| `tools` | Array | Adds custom tools available during calls. |
| `language` | String | Selects supported language. |
| `timezone` | String | TZ identifier format (per Wikipedia TZ database, e.g., `"America/New_York"`). Crucial for appointment scheduling and time-dependent behavior. Auto-handled for US numbers only. |
| `transfer_phone_number` | String | Phone number for transfers. Set to `"null"` to remove. |
| `transfer_list` | Object | Maps named transfer destinations (see below). `"default"` key overrides `transfer_phone_number` if specified. |
| `dynamic_data` | Object | Integrates external API data into agent knowledge. |
| `keywords` | Array | Boosts transcription accuracy for proper nouns or frequently mispronounced terms. Uses boost factor notation. |

#### `transfer_list` Example
```json
"transfer_list": {
  "default": "+12223334444",
  "sales": "+12223334444",
  "support": "+12223334444",
  "billing": "+12223334444"
}
```

#### `keywords` Example
```json
"keywords": ["Reece:3", "PepperoniPalace:2"]
```
Format: `"term:boost_factor"`. Boost factor strengthens transcription targeting for problem terms.

#### Response Fields

| Field | Values | Description |
|---|---|---|
| `status` | `"success"` or `"error"` | Outcome of the configuration request |
| `message` | String | Status description |
| `updates` | Object | Contains the updated inbound number settings |

### Gotchas
- `pathway_id` overrides individual prompt, `first_sentence`, and voice configurations
- Interruption threshold requires incremental tuning (10-unit adjustments recommended)
- Timezone auto-handling is only for US numbers — set explicitly for other countries
- Numbers become active immediately upon creation — no activation step needed
