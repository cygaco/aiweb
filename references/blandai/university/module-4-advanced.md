# Module 4: Advanced Features

## Lesson 1: Custom Tools

### Core Concept

Custom tools extend an agent's capabilities by enabling API calls during conversations. They're added to the agent's "toolbox" alongside built-in default tools: `Speak`, `Press Button`, `Wait`, `Finish`.

**Common use cases:**
- Sending notifications (email/SMS)
- Scheduling appointments or checking availability
- Updating CRMs or knowledge bases
- Creating support tickets
- Checking order status mid-call

### Custom Tool Properties

| Property | Type | Required | Details |
|----------|------|----------|---------|
| `name` | string | Yes | "Two to three-word names preferable" |
| `description` | string | Yes | Explains tool function to the agent |
| `url` | string | Yes | Web endpoint to call |
| `method` | string | Yes | HTTP method: `POST`, `GET`, etc. |
| `input_schema` | JSON schema | Yes | Defines input variable structure |
| `body` | object | Yes | External API request body |
| `speech` | string | Optional | Text agent speaks while awaiting API response |
| `query` | object | Optional | Query parameter additions |
| `response_data` | array | Yes | JSONPath extraction rules for API response |
| `timeout` | integer | No | Milliseconds — default: `10000` (10 seconds) |
| `headers` | object | No | e.g. `Authorization`, `Content-Type` |

### Naming Restrictions — CRITICAL

**Avoid these words in `name` or `description`** — they conflict with built-in tool names and confuse agent decision-making:

```
input, speak, transfer, switch, wait, finish, press, button, say, pause, record, play, dial, hang
```

### Input Schema Mechanics

The `input_schema` defines the structure of variables the agent will extract from the conversation and pass to the API. It must include an `"example"` property showing expected input format.

**Variable access syntax in `body`:**
- Direct: `{{input.property}}`
- Nested: `{{input.property.subproperty}}`

**Example `input_schema`:**
```json
{
  "example": {
    "speech": "Got it - one second while I book your appointment.",
    "date": "2024-04-20",
    "time": "10:00 AM",
    "service": "Haircut"
  },
  "type": "object",
  "properties": {
    "date": "YYYY-MM-DD",
    "time": "HH:MM AM/PM",
    "service": "string"
  }
}
```

### Dynamic Speech During API Wait

Define `input.speech` in the schema to allow the agent to generate contextual speech while waiting for the API response. Variables can be embedded in the speech:

```
"Checking your account details right now {{name}}!"
```

Alternatively, set a static `speech` property on the tool directly.

### Body Parameter Usage

Variables extracted via `input_schema` are referenced in the `body` using `{{input.*}}` syntax:

```json
{
  "body": {
    "name": "{{input.name}}",
    "email": "{{input.email}}"
  }
}
```

### Response Data Extraction — JSONPath

The `response_data` field uses JSONPath notation to extract values from the API response and make them available as prompt variables.

**Single value:**
```json
{
  "stylist_name": "$.stylist_name"
}
```

**Nested value:**
```json
{
  "zip_code": "$.address_info.zip"
}
```

**Array extraction:**
```json
{
  "available_times": "$.available_times"
}
```

Extracted variables become accessible in subsequent prompts via `{{variable_name}}`.

### Timeout Behavior

- Default: `10000` ms (10 seconds)
- If API doesn't respond within the window, agent proceeds to alternative actions
- To force the agent to always wait: set to a very high value, e.g. `99999999`

### Agent Decision Logic

The agent selects which tool to use by evaluating: the tool's `name`, the tool's `description`, and the current conversation context. This is why naming is critical.

### Best Practices

1. **Provide detailed `input_schema` examples** — improves extraction accuracy significantly
2. **Handle null values** — variables remain `null` until the API responds; prompt design must account for this
3. **Raise interruption threshold** — set to ~200 when gathering detailed letter-by-letter information (e.g. email addresses)
4. **Use the `speech` property** — give users natural feedback during API latency: `"Perfect, I'll schedule that right now. Give me just a second."`

---

## Lesson 2: Managing Web Agents

### Overview

Web agents are managed through a set of CRUD operations via the Bland API v1.

**Operations:**

| Operation | HTTP Method | Purpose |
|-----------|-------------|---------|
| Create agent | POST | Create a new web agent |
| Update agent | POST | Modify existing agent configuration |
| Authorize agent calls | POST | Implement authorization for agent calls |
| Delete agent | POST | Remove an agent |
| List agents | GET | Retrieve all agents |

Refer to the [Bland.ai API v1 documentation](https://docs.bland.ai) for full parameter specs on each endpoint.

---

## Lesson 3: Integrating Twilio Accounts

### Concept

Bland supports routing calls through your own Twilio account rather than Bland's shared infrastructure. This is an **enterprise feature**.

### Required Headers for Outbound Calls via Twilio

Every outbound call request must include both headers:

```json
{
  "Authorization": "BLAND_API_KEY",
  "encrypted_key": "YOUR_ENCRYPTED_KEY"
}
```

The `encrypted_key` routes calls through the connected Twilio account.

### Encrypted Keys

- Custom credentials generated via a POST operation to Bland's API
- Securely store Twilio account credentials within Bland's system
- Must be created before any Twilio-routed calls can be dispatched

### Phone Number Rules

- The `from` number specified in API requests **must be owned by the connected Twilio account** — not a Bland-purchased number
- If `from` is omitted, the system randomly selects a number from the connected Twilio account

### Operational Workflow

1. Retrieve credentials from Twilio Console
2. POST to Bland API to create an encrypted key
3. Include `encrypted_key` header on all outbound call requests
4. Upload inbound numbers via API
5. Configure webhooks — numbers auto-configure on Bland infrastructure, no additional steps required

### Inbound Numbers

- Inbound numbers must be selected from Twilio Console before uploading to Bland
- Numbers updated through Dev Portal or API auto-configure on Bland infrastructure

---

## Lesson 4: Batch Calls and Batch Analysis

### Core Concepts

Batch operations enable two key use cases:
1. **Simple Batch** — send large call volumes with a single shared prompt
2. **Campaign Batch** — initiate large-scale coordinated campaigns using `campaign_id`

### Simple Batch API Request

**Endpoint:** `POST /v1/batches` (implied — see API docs)

**Headers:**
```json
{
  "Content-Type": "application/json",
  "Authorization": "YOUR_API_TOKEN"
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base_prompt` | string | Yes | Shared prompt for all calls; supports `{{variable}}` templating from `call_data` |
| `call_data` | array | Yes | Array of call objects; each **must** include `phone_number` property |
| `from` | string | No | Originating phone number |
| `label` | string | No | Human-readable identifier for batch tracking |
| `campaign_id` | string | No | For complex multi-pathway campaigns |
| `test_mode` | boolean | No | Enables verbose response data for troubleshooting |

**CRITICAL:** Properties in `call_data` objects are **case-sensitive**.

**Variable templating in `base_prompt`:**
```
"Hello {{first_name}}, calling about your order {{order_id}}..."
```
Each object in `call_data` provides per-call variable values.

### call_data Array Example

```json
{
  "call_data": [
    { "phone_number": "+15551234567", "first_name": "Alice", "order_id": "ORD-001" },
    { "phone_number": "+15559876543", "first_name": "Bob",   "order_id": "ORD-002" }
  ]
}
```

### Batch Analysis Request

**Endpoint:** `POST /v1/batches/{batch_id}/analyze` (implied)

**Body Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `goal` | string | Context that guides analysis interpretation |
| `questions` | array of arrays | Each question: `[question_text, answer_type]` |

**Answer types:** Flexible — e.g. `"human or voicemail"`, `"string"`, `"boolean"`. Unanswerable questions default to `null`.

**Example:**
```json
{
  "goal": "Determine whether customers confirmed their pizza orders",
  "questions": [
    ["Did the customer confirm the order?", "boolean"],
    ["What toppings were requested?", "string"],
    ["Was the call answered by a human or voicemail?", "human or voicemail"]
  ]
}
```

### Analysis Response Structure

```json
{
  "status": "success",
  "message": "Analysis complete",
  "answers": {
    "call_id_1": { "question_0": true, "question_1": "pepperoni", "question_2": "human" },
    "call_id_2": { "question_0": null, "question_1": null, "question_2": "voicemail" }
  },
  "credits_used": 0.0315
}
```

### Cost Structure

- Base: `0.003` credits per analysis request
- Plus: `0.0015` credits per call analyzed
- Batch analysis is more economical than analyzing calls individually

### Batch Details

Requesting batch details returns comprehensive per-call performance data — see API docs for full response schema.

### Best Practices

1. **Use meaningful `label` values** — essential when running multiple batches per campaign
2. **Leverage variable templating** — personalize calls at scale without separate prompts per contact
3. **Enable `test_mode` during development** — verbose output simplifies debugging
4. **From number rules** — must be owned by your associated Twilio account if using Twilio integration; omit to use Bland's random selection
