# [Project Name] — Failure States

Every way the product can fail and how it should respond. This is the error handling bible. Every error message, empty state, and fallback behavior is defined here.

---

## Principles

1. **Never blame the user.** Even if they caused the error. "We couldn't process that file" not "You uploaded an invalid file."
2. **Always provide a next step.** Every error must have an action: retry, go back, try different input, or contact support.
3. **Preserve user data.** Errors must never cause data loss. If an operation fails, the user's input is still there.
4. **Degrade gracefully.** If a premium feature fails, the core product still works. If an API is down, show cached data or a meaningful empty state.
5. **Log everything.** Every error is logged server-side with enough context to debug. The user never needs to report technical details.

---

## Failure Categories

### Network Failures

| Failure | User Sees | System Does | Recovery |
|---------|-----------|-------------|----------|
| API timeout | "Taking longer than expected. [Retry]" | Log timeout, increment retry counter | Auto-retry once, then show manual retry |
| API error (500) | "Something went wrong on our end. [Retry]" | Log error + request ID | Manual retry, auto-retry after 30s |
| Network offline | "You appear to be offline. Your data is saved locally." | Queue operations for when online | Auto-resume when connection returns |
| Rate limited | "We're processing too many requests. Please wait a moment." | Log, backoff | Auto-retry with exponential backoff |

### Data Failures

| Failure | User Sees | System Does | Recovery |
|---------|-----------|-------------|----------|
| Parse failure | "We couldn't read that file. [Try different file] or [Paste text instead]" | Log file type + first 100 bytes | Alternative input method |
| Corrupt session | "Your previous data couldn't be loaded. Starting fresh." | Log corrupt data shape, clear session | Clean restart, offer export of raw data |
| Missing required field | Inline validation error on the specific field | Block advancement | Fix the field |
| Schema mismatch | Silent migration attempt, log if fails | Run schema migration | If migration fails, clear session + warn |

### AI/Processing Failures

| Failure | User Sees | System Does | Recovery |
|---------|-----------|-------------|----------|
| AI generation fails | "[Output] couldn't be generated. [Retry]" | Log prompt + error | Retry with same input |
| AI returns garbage | "The result didn't meet our quality standards. Regenerating..." | Log bad output, auto-retry | Auto-retry with adjusted prompt |
| AI timeout | "This is taking longer than usual. [Wait] or [Skip]" | Log timeout duration | Offer wait or skip (if step is optional) |
| Partial AI result | Show what succeeded, mark gaps: "Some fields couldn't be determined" | Log which fields failed | Manual fill for missing fields |

### User Errors

| Failure | User Sees | System Does | Recovery |
|---------|-----------|-------------|----------|
| Invalid file type | "Please upload a [supported formats] file" | Block upload | Try different file |
| File too large | "That file is too large. Maximum size is [limit]." | Block upload | Compress or use smaller file |
| Empty required field | Inline error: "[Field name] is required" | Block advancement | Fill the field |
| Invalid format | Inline error: "Please enter a valid [format]" | Block save | Fix the format |

### System Failures

| Failure | User Sees | System Does | Recovery |
|---------|-----------|-------------|----------|
| Database down | "We're experiencing issues. Your data is saved locally." | Log, alert ops | Operations from local cache |
| Third-party service down | "This feature is temporarily unavailable." | Log, show degraded state | Retry later, show cached results |
| Out of quota/credits | "You've used all your [credits]. [Purchase more] or [wait for reset]" | Block premium features | Purchase or wait |
| Deployment in progress | "We're updating. Please refresh in a moment." | Serve maintenance page | Auto-refresh after deploy |

---

## Empty States

<!-- GUIDANCE: What does the user see when there's no data yet? Every screen that can be empty needs a defined empty state.

| Screen | Empty State Copy | CTA |
|--------|-----------------|-----|
| Dashboard | "Complete onboarding to see your results here" | [Start Onboarding] |
| Results list | "No results yet. Run [action] to generate them." | [Run Action] |
| History | "You haven't completed any sessions yet." | [Start First Session] |
-->

---

## Error Copy Guidelines

### Structure

Every error message follows: **What happened** + **Why** (if helpful) + **What to do next**.

### Examples

- "We couldn't parse your file. The format may not be supported. [Try a different file] or [paste text instead]."
- "Generation failed. This sometimes happens with complex inputs. [Retry] — it usually works on the second try."
- "Your session expired. Don't worry — your data is saved. [Log in again] to continue."

### Anti-Patterns

- Technical jargon: "Error 500: Internal Server Error" → "Something went wrong on our end"
- Blame: "You uploaded an invalid file" → "We couldn't read that file"
- Dead ends: "An error occurred." (no next step) → "An error occurred. [Retry] or [Go back]"
- Vague: "Something went wrong" (no context) → "We couldn't generate your [output]. [Retry]"

---

## Logging Requirements

Every error must log:

1. **Timestamp** — when it happened
2. **User context** — session ID, step, what they were doing
3. **Error context** — error type, message, stack trace
4. **Input context** — what was submitted (sanitized, no PII in logs)
5. **Recovery action** — what the user did next (retry, go back, abandon)

---

## Testing Failure States

For each golden path, test:

- [ ] Network disconnected mid-operation → data preserved, can retry when online
- [ ] API returns 500 → error shown, retry works
- [ ] AI returns garbage → detected, auto-retry triggers
- [ ] Session corrupted → graceful reset, no crash
- [ ] File upload with unsupported type → clear error, alternative offered
- [ ] Rate limited → backoff works, user informed
