# Card-over-phone payment — operator safety playbook

Operational reference for the alpha-stage `card_over_phone` payment branch shipped in SP-20260519-006.

The feature is **disabled by default in production**. Enabling for testing is a deliberate operator action. This doc covers: enabling/disabling, the leak-defense model, tester guidance, failure-mode taxonomy, rollback, and non-prepaid-card incident response.

## What the feature is

A second branch on `place_order` (MCP) and the A2A confirmed=true path. When the user selects `payment_method='card_over_phone'`, the AI voice agent reads the card to the restaurant during the existing Bland call instead of relying on cash on delivery. The tester provides card number, expiration, CVV, billing zip, and optional tip percent (default 15%).

The card details are voiced once to the restaurant. They are NOT persisted in any system we control beyond the in-flight Bland call. The Bland transcript that comes back is regex-scrubbed at the connector boundary before it lands in any log, cache, or returned field.

## Three independent leak defenses

The feature ships with three independent gates. All three must hold; a failure in any one is detected by at least one of the others.

| # | Defense | Where | Failure mode |
|---|---|---|---|
| 1 | Transcript scrub | `src/lib/transcript-scrub.ts` called from `getCallStatus` in `bland.ts` BEFORE any field assignment | If the scrub regex misses a pattern, `TranscriptScrubError` throws — caller sees an explicit failure rather than a silent leak |
| 2 | `secret-guard.js` hook | `scripts/hooks/secret-guard.js`, runs PreToolUse on Edit/Write | Blocks any code/doc/fixture write containing 13–19 digit runs or 4-4-4-4 grouped digits. Allowlist: `tests/regression/SP-20260519-006/` |
| 3 | `ENABLE_CARD_OVER_PHONE` env | `fly.toml [env]` defaults to `'false'`; server enforces via `isCardOverPhoneEnabled()` | If the env flag flips to `'true'` only on the prod side, the code path executes; the helper rejects every non-exact-`'true'` value |

## Enabling on staging (or any non-prod env)

Card-over-phone is a *testing* path. Production stays cash-only.

**To enable on a staging or dev instance:**

```bash
# On the local dev machine
ENABLE_CARD_OVER_PHONE=true npm run dev
```

Or for a Fly staging app:

```bash
flyctl secrets set ENABLE_CARD_OVER_PHONE=true -a aiweb-mcp-staging
```

The server logs the resolved value once at boot (TR-6: `server.boot.env_resolved`). Operators can grep `runtime/events.jsonl` to confirm which value the running process picked up.

**To disable:**

```bash
unset ENABLE_CARD_OVER_PHONE
# or:
flyctl secrets set ENABLE_CARD_OVER_PHONE=false -a aiweb-mcp-staging
```

The change takes effect on the next process start.

## Tester onboarding

Before issuing card-over-phone access to a new tester:

1. Confirm they have a **prepaid single-use card** with a bounded balance. Recommended issuers (informational, not endorsed):
   - Privacy.com (virtual cards, per-merchant or single-use)
   - Capital One single-use card numbers
   - Apple Pay virtual cards (single-use through Wallet)
2. Recommend balance ≤ $40 (enough for two pizza orders + tip).
3. Brief them on the alpha-stage posture: the card is voiced to a human at the restaurant; the restaurant employee could in principle write it down or enter it into a POS we don't control.
4. Walk them through the chat-flow: agent asks cash/card; if card, agent reproduces the C-1 disclosure verbatim BEFORE asking for card details; agent reproduces it AGAIN before final confirmation.
5. Tell them: if the call goes sideways, the restaurant typically defaults to cash-on-delivery anyway. Worst case: they get a confused phone call from the restaurant.

## Failure-mode taxonomy

When the agent gets a parsed result back from a card-branch call, `cardFailureReason` is set to one of:

| Reason | Meaning | Recommended action |
|---|---|---|
| `declined` | Issuer declined the charge (insufficient funds, expired card, fraud-prevention flag) | Tester switches to a different prepaid card, OR falls back to cash-on-delivery. Order is NOT placed by Bland. |
| `wrong_cvv` | Restaurant entered the CVV incorrectly OR the CVV provided was wrong | Tester re-confirms CVV (no re-call this sprint — manual retry). |
| `card_not_accepted` | Restaurant doesn't take cards over the phone at all | Fall back to cash-on-delivery; record in tester notes which restaurant declines card-over-phone — useful data for the alpha. |
| `other` | Restaurant gave a non-standard reason | Capture the verbatim transcript reason in tester notes; classify post-hoc. |

## Things testers should record

For each card-over-phone order, capture in your tester notes:

- Restaurant name + phone
- `cardCharged` (yes/no)
- `cardFailureReason` (if no)
- Tip amount + total-with-tip the bot quoted
- Tester perception: did the restaurant employee seem comfortable taking the card over the phone, or hesitant?
- Did the restaurant repeat the card number back as instructed in disclosure beat 7? (this is the recoverable channel for transcription errors)
- Time on the call (longer than cash-on-delivery? by how much?)

This data drives the v1 vs v0 decision for production-grade card commerce.

## Rollback procedure

Card-over-phone is fully feature-flagged. To disable system-wide:

1. **Set env to false on every running instance.**
   - Prod: `flyctl secrets set ENABLE_CARD_OVER_PHONE=false -a aiweb-mcp` (already the default).
   - Staging: same command pointed at the staging app.
   - Local dev: `unset ENABLE_CARD_OVER_PHONE` and restart `npm run dev`.
2. **Verify with `cd:doctor`** or by calling `place_order` with `payment_method='card_over_phone'` — should return `error_code: 'card_over_phone_disabled'`.
3. **No code revert required.** The card path is additive optional fields on `place_order`. Cash callers (the default) are unaffected.
4. If you want to delete the code path entirely (post-alpha): revert the SP-20260519-006 merge commit. The three regression tests (`pci-leak-guard`, `happy-path`, `env-gate`, `secret-guard-block`) will need to be deleted too; the secret-guard.js card-number patterns can stay (they're a defense-in-depth backstop regardless of whether the feature exists).

## Non-prepaid-card incident response

**Scenario:** a tester accidentally used a real (non-prepaid) credit card for a card-over-phone test.

1. **Within the call** (if the bot is still on the line): the restaurant has already heard the card. You cannot "undo" that. The transcript on Bland's side has the audio recording. Bland's data-retention policy applies to that recording.
2. **Immediately after the call:**
   - Tester contacts the card issuer to flag the card as compromised; issuer cancels and re-issues. This is the load-bearing mitigation.
   - Capture the call ID. Open a ticket via `node scripts/sprint/issue.js create --severity high --title "non-prepaid card voiced via card-over-phone" --related-ticket T-20260519-111`.
3. **For our systems**:
   - Verify the transcript that came back through `getCallStatus` has the redacted form — `runtime/events.jsonl` should show the scrubbed `****-****-****-NNNN` form, NOT the raw digits.
   - If our logs do contain raw digits, the scrub failed — that's a P0 leak in our code. Open a high-priority issue via `node scripts/sprint/issue.js create --severity critical --title "scrubTranscript missed a card pattern"`.
4. **Tell the tester:** "We don't store card details on our systems beyond the in-flight call. Bland (the voice provider) keeps call recordings per their retention policy. The restaurant heard the card; that's outside our control. Your issuer reissuing the card is the only complete cleanup."

## Reference

- Plan Contract: `PC-20260519-0014`
- Sprint: `SP-20260519-006`
- Three leak defenses live in: `src/lib/transcript-scrub.ts`, `scripts/hooks/secret-guard.js`, `fly.toml [env]` + `src/lib/payment-method.ts#isCardOverPhoneEnabled`.
- The verbatim user-facing disclosure constant: `CARD_OVER_PHONE_DISCLOSURE` in `src/server.ts`. Test that asserts it matches copy.md C-1 byte-for-byte: `tests/regression/SP-20260519-006/happy-path.test.ts`.
- Production-grade replacement (Stripe MPP, chain tokenization): explicitly out of scope; tracked under ROADMAP "Credit card flow — production grade."
