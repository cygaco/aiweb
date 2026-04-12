# Bland Voice — Technical Reference

Source: https://www.bland.ai/product/bland-voice

---

## Voice Cloning
- Clone any voice from **a single short MP3** — no fine-tuning required
- Available preset voices: `Josh`, `Florian`, `Derek`, `June`, `Nat`, `Paige`, `maya`

---

## Emotional Control
In-context style markers embedded in text:
```
<excited>Great news about your order!</excited>
<calm>I understand, let me look into that for you.</calm>
```

Also supports dynamic emotional adjustments from context examples in the prompt.

---

## Call Flow Control
- Map every conversation step from hello to goodbye using Pathways
- Set strict guardrails to prevent hallucination / going off-script
- Define loop conditions for when conversations continue or terminate
- "Block interruptions" option — agent finishes statement uninterrupted

---

## Infrastructure & Performance
- Self-hosted model stack for lowest possible latency
- Dedicated GPUs per customer — no shared inference queues
- **Unlimited concurrency** — no queue for simultaneous calls
- Global edge network for voice delivery
- "Thousands of calls a day" scale guaranteed

---

## Analytics (on Voice calls)
- Call recordings and transcripts
- Configurable outcome tracking (dispositions)
- Sentiment scoring per call
- Citations extraction from conversation (enterprise)

---

## Preset Voice Reference

| Voice | Description |
|-------|-------------|
| `maya` | Default voice used in current implementation |
| `Josh` | — |
| `Florian` | — |
| `Derek` | — |
| `June` | — |
| `Nat` | — |
| `Paige` | — |

Test voices at: https://app.bland.ai/dashboard/voices

---

## Background Track Options
Set ambient sound for calls:
- `null` — system default
- `office` — office background
- `cafe` — café background
- `restaurant` — restaurant ambient noise
- `none` — complete silence

For pizza ordering: `restaurant` background could make calls feel more natural to the restaurant staff receiving them.

---

## Relevant for Pizza Ordering
- Use `wait_for_greeting: true` — restaurant staff answer and speak first
- Consider `<calm>` style marker for confirmation reading
- `keywords` param boosts transcription accuracy for pizza terms
- `noise_cancellation: true` if calling from noisy environments
- `block_interruptions: false` (default) — let restaurant staff interrupt with questions
