/**
 * Address-speech normalization for the Bland.ai voice prompt.
 *
 * Bland's TTS reads abbreviations letter-by-letter — "Rd" sounds like "ard".
 * This module expands common written-form abbreviations to spoken form so
 * the call agent says "Road" not "R-D".
 *
 * Applied at exactly one site: src/connectors/bland.ts where the address
 * is interpolated into the call prompt. Stored addresses remain raw.
 *
 * Coverage is intentionally conservative (false negatives over false
 * positives). Tokens are added only when high-confidence and unambiguous.
 */

interface ReplacementRule {
  // Anchored regex (must contain capture groups to preserve surroundings)
  pattern: RegExp;
  // Replacement string with $1, $2 backrefs as needed
  replacement: string;
}

// Street suffixes — match at end of a word, optionally with trailing period,
// followed by a non-letter (comma, space-end, end of string). The leading
// space ensures we don't match mid-word.
function suffix(abbr: string, full: string): ReplacementRule {
  // Match: leading space + abbr + optional period + (comma|whitespace+nondigit|end)
  // We keep the trailing whitespace/punct in the replacement.
  const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    pattern: new RegExp(`(\\s)${escaped}\\.?(?=\\s|,|$)`, "g"),
    replacement: `$1${full}`,
  };
}

// Trailing or standalone directional (e.g. "St NW" → "Street Northwest")
function directional(abbr: string, full: string): ReplacementRule {
  const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    pattern: new RegExp(`(\\s)${escaped}(?=\\s|,|$)`, "g"),
    replacement: `$1${full}`,
  };
}

// Leading directional after a house number (e.g. "123 N Main St" → "123 North Main St")
function leadingDirectional(abbr: string, full: string): ReplacementRule {
  const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    pattern: new RegExp(`(\\b\\d+\\s)${escaped}(\\s)`, "g"),
    replacement: `$1${full}$2`,
  };
}

// Unit indicators — preceded by comma+space OR start, followed by alphanumeric
function unit(abbr: string, full: string): ReplacementRule {
  const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    pattern: new RegExp(`(,\\s|^|\\s)${escaped}\\.?(\\s+[\\w#-])`, "g"),
    replacement: `$1${full}$2`,
  };
}

// State codes — only when "<comma><space><CODE><space><5-digit-zip>" or end-of-string
function stateCode(code: string, full: string): ReplacementRule {
  return {
    pattern: new RegExp(`(,\\s)${code}(\\s+\\d{5}(?:-\\d{4})?|\\s*$)`, "g"),
    replacement: `$1${full}$2`,
  };
}

// Street suffix rules. "Way" is excluded — most common English meaning is the
// full word already. "Trl" is included for trail addresses.
const STREET_SUFFIXES: ReplacementRule[] = [
  suffix("Rd", "Road"),
  suffix("St", "Street"),
  suffix("Ave", "Avenue"),
  suffix("Blvd", "Boulevard"),
  suffix("Ln", "Lane"),
  suffix("Dr", "Drive"),
  suffix("Pl", "Place"),
  suffix("Ct", "Court"),
  suffix("Pkwy", "Parkway"),
  suffix("Cir", "Circle"),
  suffix("Hwy", "Highway"),
  suffix("Ter", "Terrace"),
  suffix("Trl", "Trail"),
];

// Directional rules. Two-letter forms first so they match before single letters.
const DIRECTIONAL_TRAILING: ReplacementRule[] = [
  directional("NE", "Northeast"),
  directional("NW", "Northwest"),
  directional("SE", "Southeast"),
  directional("SW", "Southwest"),
  directional("N", "North"),
  directional("S", "South"),
  directional("E", "East"),
  directional("W", "West"),
];

const DIRECTIONAL_LEADING: ReplacementRule[] = [
  leadingDirectional("NE", "Northeast"),
  leadingDirectional("NW", "Northwest"),
  leadingDirectional("SE", "Southeast"),
  leadingDirectional("SW", "Southwest"),
  leadingDirectional("N", "North"),
  leadingDirectional("S", "South"),
  leadingDirectional("E", "East"),
  leadingDirectional("W", "West"),
];

const UNITS: ReplacementRule[] = [
  unit("Apt", "Apartment"),
  unit("Ste", "Suite"),
  unit("Bldg", "Building"),
  unit("Fl", "Floor"),
  unit("Rm", "Room"),
];

// State codes: top-5 most common in real-world delivery. Others left as letters
// (Bland TTS pronounces 2-letter codes acceptably; we expand the table as we
// observe specific mispronunciations).
const STATE_CODES: ReplacementRule[] = [
  stateCode("CA", "California"),
  stateCode("NY", "New York"),
  stateCode("TX", "Texas"),
  stateCode("FL", "Florida"),
  stateCode("IL", "Illinois"),
];

// Saint disambiguation: "St." or "St" followed by whitespace + a Capitalized
// word with a LOWERCASE second character → "Saint" (e.g. "St. Louis",
// "St. Mary's"). The lowercase requirement excludes directional pairs like
// "NW" (which is [A-Z][A-Z]) so "Main St NW" stays a Street, not a Saint.
// Bare "St" at end of a street segment is handled by STREET_SUFFIXES.
const SAINT_PREFIX: ReplacementRule = {
  pattern: /\bSt\.?(\s+)(?=[A-Z][a-z][a-zA-Z']*)/g,
  replacement: "Saint$1",
};

// "#" symbol → "Number" when followed by a digit (avoids matching hashtags etc.)
const HASH_NUMBER: ReplacementRule = {
  pattern: /(^|\s|,\s)#\s*(?=\d)/g,
  replacement: "$1Number ",
};

/**
 * Normalize an address string for spoken-form rendering.
 *
 * - Stored addresses are unchanged; this is a render-time transform.
 * - Idempotent: speakableAddress(speakableAddress(x)) === speakableAddress(x).
 * - Conservative: unknown tokens pass through.
 */
export function speakableAddress(raw: string): string {
  if (!raw) return raw;

  let out = raw;

  // 1. Saint prefix BEFORE bare "St" → "Street", so "St. Louis" wins over "Street Louis"
  out = out.replace(SAINT_PREFIX.pattern, SAINT_PREFIX.replacement);

  // 2. Hash → Number (positional)
  out = out.replace(HASH_NUMBER.pattern, HASH_NUMBER.replacement);

  // 3. Street suffixes
  for (const rule of STREET_SUFFIXES) {
    out = out.replace(rule.pattern, rule.replacement);
  }

  // 4. Leading directionals (after house number)
  for (const rule of DIRECTIONAL_LEADING) {
    out = out.replace(rule.pattern, rule.replacement);
  }

  // 5. Trailing/standalone directionals
  for (const rule of DIRECTIONAL_TRAILING) {
    out = out.replace(rule.pattern, rule.replacement);
  }

  // 6. Unit indicators
  for (const rule of UNITS) {
    out = out.replace(rule.pattern, rule.replacement);
  }

  // 7. State codes (only with following zip / end-of-string)
  for (const rule of STATE_CODES) {
    out = out.replace(rule.pattern, rule.replacement);
  }

  return out;
}
