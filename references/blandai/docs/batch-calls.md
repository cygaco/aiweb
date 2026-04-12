# Bland.ai — Batch Calls Reference

Source: https://docs.bland.ai/tutorials/batch-calls

---

## What Batch Calls Are
High-volume outbound campaigns. Upload recipient list via CSV; Bland dispatches all calls with shared configuration.

---

## CSV Requirements

- **Required column:** `phone_number` (one per row)
- **Column naming:** No spaces — use underscores or camelCase (`customer_name`, not `customer name`)
- **Additional columns** become dynamic variables accessible as `{{column_name}}` in task prompts or pathways
- Invalid/blank phone numbers are skipped automatically with error logging

### Example CSV
```csv
phone_number,customer_name,order_id
+14155551234,Alex,ORD-001
+14155555678,Sam,ORD-002
```

Usage in task: `"Hello {{customer_name}}, calling about order {{order_id}}..."`

---

## Lifecycle & Status Webhook

The batch system POSTs once per phase to your webhook:

```
validating → dispatching → in_progress (or in_progress_chunked for large batches)
  → [optionally: waiting_for_scheduled_calls]
  → completed | failed | completed_partial
```

Each webhook payload contains: `batch_id`, `status`, `timestamp`

Final events include: call counts and error details.

**Your server must respond with 200 within 10 seconds.** Do heavy processing asynchronously.

---

## Processing Statuses

| Status | Description |
|--------|-------------|
| Initializing | Batch created, not yet started |
| Validating | Phone numbers being validated |
| Dispatching | Calls being queued |
| In Progress | Calls actively running |
| In Progress (Chunked) | Large batch processing in chunks |
| Waiting for Scheduled Calls | Some calls scheduled for future time |
| Completed | All calls finished |
| Completed Partial | Some calls failed |
| Failed | Batch-level failure |

---

## Shared Configuration

Pathways and tools apply across the **entire batch** — you can't configure per-row (use `request_data` / CSV columns for per-call variation instead).

---

## Monitoring

Access individual call results via Call Logs filtered by `batch_id`.

---

## Cost Model (from Module 4)

- Base: `$0.003` per call + `$0.0015` per minute
- Batch analysis available for post-campaign insight queries

---

## Relevance for Pizza Ordering

Not directly applicable for Wave 00 (single orders). Relevant for:
- Future: sending follow-up calls post-delivery
- Outreach campaigns across multiple restaurant locations
- Load testing the connector against many numbers
