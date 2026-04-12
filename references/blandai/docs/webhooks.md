# Bland.ai — Webhooks Reference

Sources:
- https://docs.bland.ai/tutorials/webhooks
- https://docs.bland.ai/api-v1/post/calls (webhook param)

---

## Two Types of Webhooks

### 1. Post-Call Webhook (most common)
Set via `webhook` parameter on POST /calls. Fired once after call completes with full call data.

```json
{
  "webhook": "https://your-server.com/bland/callback"
}
```

### 2. Pathway Webhook Node
Executes an HTTP request **during** a live call at a specific conversation point. Used for live data lookups or order confirmation mid-call.

---

## Post-Call Webhook

### Setup
Pass `webhook` URL when creating the call. Must be HTTPS. Server must return 200 within 10 seconds.

### Payload
The post-call webhook delivers the same fields as GET /calls/{call_id}:
- `call_id`, `status`, `completed`
- `concatenated_transcript`, `summary`
- `variables`, `analysis`
- `metadata` (your custom data passed at call creation)
- `price`, `call_length`, `recording_url`

### Streaming Webhook Events
Use `webhook_events` array to stream events **during** the call:

| Event | Description |
|-------|-------------|
| `queue` | Call queued |
| `call` | Call connected |
| `latency` | Latency measurements |
| `webhook` | Pathway webhook executed |
| `tool` | Custom tool executed |
| `dynamic_data` | Dynamic data fetched |
| `citations` | Citations extracted |

---

## Pathway Webhook Node

### Configuration (in app.bland.ai pathway builder)
1. Open pathway → New Node → select Webhook icon
2. Configure:
   - **HTTP Method**: GET, POST, etc.
   - **URL**: Supports variable interpolation: `https://api.example.com/orders?id={{order_id}}`
   - **Authentication**: None / Bearer token / Basic auth
   - **Headers**: Key-value pairs (can use Bland Secrets for sensitive values)
   - **Body**: JSON with extracted variables

### Built-in Variables Available in Webhook
```
{{phone_number}}    {{timezone}}    {{country}}
{{state}}           {{city}}        {{zip}}
{{call_id}}         {{now}}         {{now_utc}}
{{from}}            {{to}}
{{short_from}}      {{short_to}}
```

### Payload Example
```json
{
  "name": "{{user_name}}",
  "interested": "{{user_interested}}",
  "order_type": "delivery",
  "call_id": "{{call_id}}"
}
```

### Response Handling
Enable **Response Data** to extract JSON values using JSONPath:
- Define variable name + JSONPath (e.g., `$.data.order_id`)
- Enables conditional routing based on HTTP status codes (200, 500, etc.)
- Extracted values usable in subsequent nodes

### Advanced Options
| Option | Description |
|--------|-------------|
| Timeout | Max wait before failure |
| Retries | Auto-retry attempts |
| Server Rerouting | Prevents CORS issues (disable if problematic) |
| Speech During Processing | Agent speaks while webhook runs — avoids dead silence |

**Always enable "Speech During Processing"** for outbound order calls — silence during API calls sounds broken to the restaurant.

---

## Inbound Number Webhook
Set via `webhook` when provisioning an inbound number:
```json
{
  "webhook": "https://your-server.com/inbound-handler"
}
```
Receives `call_id` and transcript after each inbound call completes.

---

## Security
- Use HTTPS only
- Validate `call_id` matches a known call before processing
- Use `metadata` field to pass signed tokens for verification
