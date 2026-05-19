/**
 * src/lib/transcript-scrub.ts — SP-20260519-006 R-3.
 *
 * Strip card-number and CVV-adjacent runs from a raw call transcript
 * BEFORE the transcript field leaves the bland connector module.
 *
 * Runs at the connector boundary in src/connectors/bland.ts —
 * specifically inside getCallStatus before BlandCallStatus.transcript
 * is assigned. Any code that touches the transcript after this point
 * sees the scrubbed form only.
 *
 * Scrubbed form keeps the last 4 digits visible. Examples (synthetic):
 *   <16 contiguous digits>             → ****-****-****-<last 4>
 *   <4-4-4-4 dash-separated digits>    → ****-****-****-<last 4>
 *   <4-4-4-4 space-separated digits>   → ****-****-****-<last 4>
 *   CVV <3-4 digits>                   → CVV ***
 *
 * Defense-in-depth: if the input matched a card pattern but the output
 * is byte-identical, scrubTranscript throws TranscriptScrubError. The
 * caller can emit TR-4 (scrub_transcript.assertion_failed) before
 * re-throwing.
 *
 * NOTHING IN THIS MODULE PERSISTS CARD DETAILS. Pure function;
 * input string is processed in memory only.
 */

// 13–19 contiguous digits with word boundaries (excludes sim_<timestamp>,
// UUIDs whose digit segments are surrounded by hex/letters).
const CARD_CONTIGUOUS = /\b\d{13,19}\b/g;

// 4-4-4-4 grouped with single space or dash separators.
const CARD_GROUPED = /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g;

// CVV optionally followed by colon/equals + 3-4 digits.
const CVV_ADJACENT = /\bCVV\s*[:=]?\s*\d{3,4}\b/gi;

export class TranscriptScrubError extends Error {
  readonly patternMatched: string;
  constructor(patternMatched: string) {
    super(
      `scrubTranscript assertion: input matched ${patternMatched} but output is byte-identical (broken scrub)`,
    );
    this.name = "TranscriptScrubError";
    this.patternMatched = patternMatched;
  }
}

function lastFour(digits: string): string {
  const stripped = digits.replace(/[\s-]/g, "");
  return stripped.slice(-4);
}

function redactContiguous(match: string): string {
  return `****-****-****-${lastFour(match)}`;
}

function redactGrouped(match: string): string {
  return `****-****-****-${lastFour(match)}`;
}

function redactCvv(match: string): string {
  return match.replace(/\d{3,4}\b/, "***");
}

/**
 * Scrub a raw transcript. Pure function; returns the redacted form.
 *
 * @throws TranscriptScrubError if any pattern matched but the output is
 *         byte-identical to the input (signals broken scrubbing).
 */
export function scrubTranscript(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) return raw;

  let scrubbed = raw;
  let matchedPattern: string | null = null;

  if (CARD_GROUPED.test(scrubbed)) {
    matchedPattern = "four_group";
    scrubbed = scrubbed.replace(CARD_GROUPED, redactGrouped);
  }
  if (CARD_CONTIGUOUS.test(scrubbed)) {
    matchedPattern = matchedPattern || "thirteen_to_nineteen_run";
    scrubbed = scrubbed.replace(CARD_CONTIGUOUS, redactContiguous);
  }
  if (CVV_ADJACENT.test(scrubbed)) {
    matchedPattern = matchedPattern || "cvv_adjacent";
    scrubbed = scrubbed.replace(CVV_ADJACENT, redactCvv);
  }

  if (matchedPattern && scrubbed === raw) {
    throw new TranscriptScrubError(matchedPattern);
  }

  return scrubbed;
}

/**
 * Diagnostic: counts how many redactions happened. Used by the
 * place_order.card_over_phone.result event (TR-3) as a defense-in-depth
 * signal that the scrub actually fired on a card-branch call.
 */
export function countRedactions(raw: string): number {
  if (typeof raw !== "string" || raw.length === 0) return 0;
  let count = 0;
  count += (raw.match(CARD_GROUPED) || []).length;
  count += (raw.match(CARD_CONTIGUOUS) || []).length;
  count += (raw.match(CVV_ADJACENT) || []).length;
  return count;
}
