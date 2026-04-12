# Bland.ai — GET /calls/{call_id} API Reference

Source: https://docs.bland.ai/api-v1/get/calls-id

Retrieves full details, transcript, and analysis for a completed or in-progress call.

---

## Request

```
GET https://api.bland.ai/v1/calls/{call_id}
Authorization: {API_KEY}
```

**Path parameter:** `call_id` (string, required)

---

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `call_id` | number | Unique call identifier |
| `call_length` | number | Duration in **minutes** |
| `to` | string | Called phone number |
| `from` | string | Calling phone number |
| `inbound` | boolean | `true` = received call, `false` = outbound |
| `created_at` | string | When call was queued (ISO timestamp) |
| `started_at` | string | When call connected |
| `end_at` | string | Auto-termination time based on `max_duration` |
| `completed` | boolean | Whether call has finished |
| `queue_status` | string | See status progression below |
| `status` | string | High-level status: `completed`, `failed`, `busy`, `no-answer`, `canceled`, `unknown` |
| `error_message` | string | Error description if applicable |
| `answered_by` | string | `human`, `voicemail`, `unknown`, `no-answer`, `null` |
| `call_ended_by` | string | `ASSISTANT` or `USER` |
| `record` | boolean | Whether recording was enabled |
| `recording_url` | string | URL to audio recording |
| `concatenated_transcript` | string | Full call transcript as plain text (excludes system messages). Primary field for parsing order confirmation |
| `transcripts` | array | Phrase-by-phrase objects: `{id, created_at, text, user}` |
| `summary` | string | Post-call AI-generated summary |
| `variables` | object | System and extracted variables from the call |
| `analysis` | object | Populated post-call analysis data (if `analysis_schema` set) |
| `analysis_schema` | object | The schema template used for analysis |
| `metadata` | object | Custom metadata passed at call creation |
| `request_data` | object | Original request parameters |
| `pathway_id` | string | Pathway used (if any) |
| `pathway_logs` | string | Detailed pathway execution logs |
| `pathway_version` | number | Pathway version used |
| `batch_id` | string | Batch ID if part of a batch |
| `transferred_to` | string | Number that received transfer |
| `transferred_at` | string | Transfer timestamp |
| `price` | number | Call cost in USD |
| `local_dialing` | boolean | Whether local dialing was used |
| `endpoint_url` | string | Deployment endpoint |
| `max_duration` | number | Max duration set at call creation |
| `voice_id` | string | Voice used |
| `corrected_duration` | string | Actual duration in **seconds** |
| `citations` | array | Extracted citations (enterprise feature) |
| `warm_transfer_call` | object | Warm transfer metadata |
| `is_proxy_agent_call` | boolean | Whether this was a proxy agent call |

---

## Status Progression

**`queue_status` lifecycle:**
```
new → queued → allocated → started → complete
```

**Error variants:** `pre_queue_error`, `queue_error`, `call_error`, `complete_error`

**High-level `status` values:**
- `completed` — Call finished normally
- `failed` — System error
- `busy` — Restaurant line busy
- `no-answer` — No one picked up
- `canceled` — Canceled before connecting
- `unknown` — Indeterminate state

---

## Polling Strategy

The call API is poll-based (no push for status). Recommended approach:

```
place_order → wait 30–60s → check status
  if in_progress/queued → wait another 30s → check again
  if completed → parse transcript
  if failed/no-answer → retry with next restaurant
```

---

## Transcript Parsing

The `concatenated_transcript` field is plain text. Parse for:
- `$XX.XX` patterns → total quoted
- `\d+\s*(minutes?|mins?)` → estimated delivery time
- `confirm|confirmed|confirmed your order|on its way|minutes` → order success signals
- `don't deliver|outside.*area` → delivery area issue
- `closed|not available` → restaurant unavailable

The `summary` field is AI-generated and more reliable for detecting order confirmation intent. Consider using it as primary signal and transcript as secondary.

---

## Example Response (Completed Call)

```json
{
  "call_id": "9d404c1b-6a23-4426-953a-a52c392ff8f1",
  "status": "completed",
  "completed": true,
  "call_length": 1.8,
  "corrected_duration": "108",
  "answered_by": "human",
  "call_ended_by": "ASSISTANT",
  "concatenated_transcript": "Restaurant: Thank you for calling Domino's...\nAgent: Hi, I'd like to place an order...",
  "summary": "AI agent successfully placed an order for 1 Large Pepperoni. Restaurant confirmed $14.99 total, 30 minute delivery.",
  "price": 0.027,
  "recording_url": "https://...",
  "variables": {
    "order_confirmed": true,
    "total_quoted": 14.99
  }
}
```
