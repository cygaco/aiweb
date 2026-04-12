# Bland.ai — POST /calls API Reference

Source: https://docs.bland.ai/api-v1/post/calls

---

## Authentication

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `authorization` | string | Yes | API key (`Bearer` prefix added automatically by SDK) |
| `encrypted_key` | string | No | Special key for BYOT (Bring Your Own Twilio) accounts |

---

## Request Body Parameters

### Core (Required)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `phone_number` | string | Yes | — | Target number, E.164 preferred (`+12223334444`). Defaults to `+1` if no country code. Also accepts `2223334444`, `+1 (222) 333-4444`. Invalid: `12223334444`, extensions |
| `task` | string | Yes* | — | Agent instructions, max 2,000 chars. *Not required if `pathway_id` is provided |

### Routing

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pathway_id` | string | No | — | Pre-built conversational pathway from dev portal. Overrides `task`, `first_sentence`, `voice` |
| `pathway_version` | integer | No | production | Specific pathway version number |
| `persona_id` | string | No | — | Pre-configured persona template ID |

### Agent Behavior

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `voice` | string | No | — | Preset names: `Josh`, `Florian`, `Derek`, `June`, `Nat`, `Paige`, `maya` |
| `first_sentence` | string | No | — | Opening phrase agent speaks (overridden by `pathway_id`) |
| `model` | string | No | `base` | `base` or `turbo`. Base: full feature set (transfers, IVR, tools). Turbo: lower latency, no transfers or custom tools |
| `language` | string | No | `babel-en` | 40+ language codes: `en-US`, `es`, `fr`, `de`, `ja`, `zh`, etc. |
| `wait_for_greeting` | boolean | No | `false` | Wait for recipient to speak first. **Use `true` for restaurant outbound calls** |
| `temperature` | float | No | `0.7` | Response randomness 0–1 |
| `interruption_threshold` | number | No | `500` | Patience in milliseconds before agent responds to interruption |
| `block_interruptions` | boolean | No | `false` | Ignore user interruptions; agent completes statements uninterrupted |

### Dispatch & Scheduling

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `from` | string | No | — | Outbound caller number owned by account (`BLAND_FROM_NUMBER`) |
| `dialing_strategy` | object | No | — | Local number matching or custom pooling |
| `timezone` | string | No | `America/Los_Angeles` | TZ identifier for scheduling/time-based logic |
| `start_time` | string | No | — | Scheduled call time: `YYYY-MM-DD HH:MM:SS -HH:MM` |
| `max_duration` | integer | No | `30` | Call timeout in **minutes** |
| `transfer_phone_number` | string | No | — | Number for human transfer |
| `transfer_list` | object | No | — | Multi-department transfer routing (see example) |

### Knowledge & Tools

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tools` | array | No | — | Custom tool or knowledge base IDs. Format: `TL-{uuid}` or `KB-{uuid}` |
| `dynamic_data` | object[] | No | — | External API integration for live agent knowledge during call |
| `keywords` | string[] | No | `[]` | Transcription boost for proper nouns. Max 20. Format: `"word:2"` (boost factor). E.g. `["pepperoni:2", "margherita:2"]` |

### Audio

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `record` | boolean | No | `false` | Record call audio |
| `background_track` | string | No | `null` | Ambient sound: `null`, `office`, `cafe`, `restaurant`, `none` |
| `noise_cancellation` | boolean | No | `false` | Filter background noise from caller |
| `pronunciation_guide` | array | No | — | Array of `{word, pronunciation, case_sensitive, spaced}` objects |

### Voicemail

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `voicemail` | object | No | — | Config: `{message, action, sms: {to, from, message}, sensitive}` |
| `retry` | object | No | — | `{wait: seconds, voicemail_action, voicemail_message}` |
| `answered_by_enabled` | boolean | No | `false` | Detect if answered by human vs voicemail |

### Post-Call & Analysis

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `webhook` | string | No | — | HTTPS URL — receives full call data after completion |
| `webhook_events` | array | No | — | Stream events during call: `queue`, `call`, `latency`, `webhook`, `tool`, `dynamic_data`, `citations` |
| `summary_prompt` | string | No | — | Custom post-call summarization instructions, max 2,000 chars |
| `citation_schema_ids` | string[] | No | — | Post-call analysis schema UUIDs (enterprise) |
| `dispositions` | string[] | No | built-in | Custom outcome tags — AI selects one post-call |
| `metadata` | object | No | — | Arbitrary call tracking data — returned in webhooks |

### Advanced

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `request_data` | object | No | — | Variables injected into task/pathway via `{{variable}}` syntax |
| `guard_rails` | array | No | — | Compliance monitoring rules (TCPA, custom prompts) |
| `ignore_button_press` | boolean | No | `false` | Disable DTMF keypad processing |
| `precall_dtmf_sequence` | string | No | — | DTMF sequence before call connects. Valid: `0-9`, `*`, `#`, `w` (pause) |

---

## Response

### Success
```json
{
  "status": "success",
  "message": "Call successfully queued.",
  "call_id": "9d404c1b-6a23-4426-953a-a52c392ff8f1",
  "batch_id": null
}
```

### Error
```json
{
  "status": "error",
  "message": "Description of error",
  "errors": ["field-specific error messages"]
}
```

---

## Code Examples

### Minimal Task Call
```json
{
  "phone_number": "+14155552671",
  "task": "You are calling Joe's Pizza to place a delivery order for 1 Large Pepperoni.",
  "wait_for_greeting": true,
  "record": true
}
```

### Pathway Call with Request Data
```json
{
  "phone_number": "+14155552671",
  "pathway_id": "a0f0d4ed-f5f5-4f16-b3f9-22166594d7a7",
  "request_data": {
    "customer_name": "Alex",
    "order": "1 Large Pepperoni",
    "address": "123 Main St"
  },
  "wait_for_greeting": true,
  "record": true
}
```

### Full Featured Call
```json
{
  "phone_number": "+14155552671",
  "task": "Say hello to {{name}}",
  "voice": "maya",
  "model": "base",
  "request_data": { "name": "John Doe" },
  "max_duration": 5,
  "wait_for_greeting": true,
  "record": true,
  "keywords": ["pepperoni:2", "margherita:2"],
  "webhook": "https://your-server.com/bland-webhook",
  "metadata": { "order_id": "ORD-001" }
}
```

### Transfer List Routing
```json
{
  "transfer_list": {
    "default": "+12223334444",
    "sales": "+12223334444",
    "support": "+12223334446",
    "billing": "+12223334447"
  }
}
```

### Voicemail Handling
```json
{
  "voicemail": {
    "message": "Hi, this is an AI calling from PizzaCo. We'll try again shortly.",
    "action": "leave_message",
    "sensitive": false
  },
  "retry": {
    "wait": 300,
    "voicemail_action": "leave_message",
    "voicemail_message": "Trying again..."
  }
}
```

---

## Notes for Pizza Ordering Use Case

- Always use `wait_for_greeting: true` — restaurants answer and speak first
- `model: "base"` required — Turbo lacks IVR navigation (needed for phone trees)
- `max_duration: 5` is sufficient for a pizza order
- `record: true` for debugging and quality review
- Use `keywords` to boost transcription accuracy: `["pepperoni", "margherita", "sausage", "large", "medium"]`
- `request_data` lets you inject order details into task prompt via `{{variable}}` syntax
- `metadata` is ideal for tracking `order_id` — returned in webhook payload
