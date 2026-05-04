# PRD: Address Speech Normalization

## 1. Title + Classification

**Address Speech Normalization** — bug fix / small feature

## 2. Surface

- `src/lib/address-speech.ts` (new module)
- `src/connectors/bland.ts` (one-line call site)
- `tests/address-speech.test.ts` (new)

## 3. Context

The Bland.ai voice agent reads the user's delivery address verbatim from the call prompt. The user's stored address is a single string field (`UserProfile.default_address` in `src/lib/profile-store.ts:7`). When that string contains common abbreviations like `"Rd"` or `"Ave"`, Bland's TTS pronounces them letter-by-letter — `"Rd"` becomes `"R-D"` which the user reports as `"Ard"`.

Today there is **no normalization layer** anywhere between stored address and Bland prompt. The only processing in `src/connectors/bland.ts:48–67` is XML escaping (ampersand, less-than, greater-than) and control-char stripping. Abbreviations pass through untouched.

The fix is a single normalization function applied at exactly one site — where the address is interpolated into the call prompt. Stored addresses remain raw. Confirmation tokens (`src/lib/confirmation-token.ts`) still bind to the raw form.

## 4. Goal

When Bland reads the address aloud, common written-form abbreviations come out as full spoken words. Conservative coverage; false negatives over false positives.

## 5. Acceptance Criteria

1. **A1.** `speakableAddress("123 Main Rd")` returns `"123 Main Road"`.
2. **A2.** `speakableAddress("123 Main St")` returns `"123 Main Street"`.
3. **A3.** `speakableAddress("123 N Main St NW")` returns `"123 North Main Street Northwest"`.
4. **A4.** `speakableAddress("123 Main St, Apt 4B, San Francisco, CA 94110")` returns `"123 Main Street, Apartment 4B, San Francisco, California 94110"`.
5. **A5.** **Saint disambiguation:** `speakableAddress("123 Rd, St. Louis, MO 63101")` keeps `"St. Louis"` as `"Saint Louis"` (NOT `"Street Louis"`). The bare `Rd` still becomes `Road`.
6. **A6.** **No-op when nothing matches:** `speakableAddress("42 Calle del Sol")` returns the input unchanged.
7. **A7.** **Already-spelled-out is no-op:** `speakableAddress("123 Main Road")` returns `"123 Main Road"` (no double expansion).
8. **A8.** Casing of the original is preserved where the rule allows (e.g., "rd" lowercase → "road" lowercase if observed; canonical handling: title case the replacement).
9. **A9.** Applied at exactly one site: `buildCallPrompt()` in `src/connectors/bland.ts` line ~100, when interpolating the `Address:` line. **Stored address remains raw** — `UserProfile.default_address` and `PlaceOrderRequest.deliveryAddress` are unchanged.
10. **A10.** Confirmation tokens still bind to the raw address (no semantic break).

## 6. Approach

### New module `src/lib/address-speech.ts`

```ts
export function speakableAddress(raw: string): string;
```

### Coverage tables (high-confidence only)

| Category | Entries (abbreviation → spoken) |
|---|---|
| **Street suffixes** | Rd→Road, St→Street, Ave→Avenue, Blvd→Boulevard, Ln→Lane, Dr→Drive, Pl→Place, Ct→Court, Pkwy→Parkway, Cir→Circle, Hwy→Highway, Ter→Terrace, Way→Way (no-op), Trl→Trail |
| **Directionals** | N→North, S→South, E→East, W→West, NE→Northeast, NW→Northwest, SE→Southeast, SW→Southwest |
| **Unit indicators** | Apt→Apartment, Ste→Suite, Bldg→Building, Fl→Floor, Rm→Room, #→Number |
| **State codes (selective — top 5)** | CA→California, NY→New York, TX→Texas, FL→Florida, IL→Illinois |

(Other 2-letter state codes: leave as letters. Bland's TTS generally pronounces those acceptably; expansion table can grow as cases are observed.)

### Replacement strategy — conservative, prefer false negatives

- Use word-boundary regex `\b(token)\b\.?` for each token.
- **Saint disambiguation:** `\bSt\.\b` followed by whitespace + a capitalized word → "Saint" (e.g. "St. Louis", "St. Mary's"). Bare `\bSt\b\.?` not followed by a capitalized name → "Street".
- **Directional position:** match `\bN\b`, `\bS\b`, etc. only when preceded by a number+space (start of street segment) OR followed by a known street suffix in the same comma segment. Don't expand bare letters that could be initials in a name.
- **State codes:** match only when preceded by `, ` and followed by ` <5digit zip>` (or end of string). Avoids accidental expansion of "CA" inside a building name.
- **Unit indicators:** match in unit-context — preceded by comma+space, followed by alphanumeric room/suite identifier.
- Casing of the replacement: title-case the canonical spoken form (e.g. "Road", "Street", "California"). Don't try to preserve odd input casings like "rD"; those are unlikely in real addresses.

### Apply site

`src/connectors/bland.ts:100`:

```ts
- Address: ${wrapCustomerData("deliveryAddress", order.deliveryAddress)}
```

becomes:

```ts
- Address: ${wrapCustomerData("deliveryAddress", speakableAddress(order.deliveryAddress))}
```

That is the **only** code change in `bland.ts`. The `wrapCustomerData()` helper is unchanged. The stored address everywhere else (profile store, MCP/A2A inputs, confirmation token cart) remains raw.

## 7. Dependencies / Blockers

- None. Pure utility module + one-line call site change.

## 8. Out of Scope

- Address parsing into structured fields (street/city/state/zip). That's an optional future item, flagged in ROADMAP.
- Phonetic respelling for unusual menu items.
- SSML markup (Bland may not support; not needed for this fix).
- Restaurant-name pronunciation overrides (separate, future).
- Non-US addresses — `speakableAddress` is a no-op when no tokens match.
- Numbers (house numbers, zip codes). Bland's TTS reads digits acceptably as-is.
- Mutation of stored addresses — strictly rendering-time only.

## 9. Test Plan

`tests/address-speech.test.ts` — table-driven, ~25 cases:

| # | Input | Expected | Why |
|---|---|---|---|
| 1 | `"123 Main Rd"` | `"123 Main Road"` | Happy path — the user-reported bug |
| 2 | `"123 Main St"` | `"123 Main Street"` | Common suffix |
| 3 | `"456 Elm Ave"` | `"456 Elm Avenue"` | Common suffix |
| 4 | `"789 Pine Blvd"` | `"789 Pine Boulevard"` | Common suffix |
| 5 | `"123 N Main St"` | `"123 North Main Street"` | Directional + suffix |
| 6 | `"123 Main St NW"` | `"123 Main Street Northwest"` | Trailing directional |
| 7 | `"123 Main St, Apt 4B"` | `"123 Main Street, Apartment 4B"` | Apt expansion |
| 8 | `"123 Main St, Ste 200"` | `"123 Main Street, Suite 200"` | Suite expansion |
| 9 | `"123 Rd, St. Louis, MO 63101"` | `"123 Road, Saint Louis, MO 63101"` | Saint disambiguation |
| 10 | `"100 St. Mary's Hospital Rd"` | `"100 Saint Mary's Hospital Road"` | Saint preserves; suffix expands |
| 11 | `"42 Calle del Sol"` | `"42 Calle del Sol"` | No-op (no matches) |
| 12 | `"123 Main Road"` | `"123 Main Road"` | No-op (already spelled out) |
| 13 | `"123 Main St, San Francisco, CA 94110"` | `"123 Main Street, San Francisco, California 94110"` | State (CA in top 5) |
| 14 | `"123 Main St, Springfield, MA 01103"` | `"123 Main Street, Springfield, MA 01103"` | State (MA NOT in top 5 — left unchanged) |
| 15 | `""` | `""` | Empty input |
| 16 | `"123 Main"` | `"123 Main"` | No suffix → no-op |
| 17 | `"123 Main Rd Apt 2"` | `"123 Main Road Apartment 2"` | Compact form |
| 18 | `"#42 Main St"` | `"Number 42 Main Street"` | `#` expansion |
| 19 | `"123 Main Pkwy"` | `"123 Main Parkway"` | Pkwy |
| 20 | `"123 Main Hwy"` | `"123 Main Highway"` | Hwy |
| 21 | `"123 SW Broadway"` | `"123 Southwest Broadway"` | Two-letter directional, leading |
| 22 | `"Main St & 1st Ave"` | `"Main Street & 1st Avenue"` | Intersection-style |
| 23 | `"123 Main Cir"` | `"123 Main Circle"` | Cir |
| 24 | `"123 East Main Street"` | `"123 East Main Street"` | No-op when full forms used |
| 25 | `"123 Saint Mark's Pl"` | `"123 Saint Mark's Place"` | Saint as full word + suffix expands |

Plus one **integration check** in the same test file: `buildCallPrompt(orderWithRdAddress)` contains the substring `"Road"` and does NOT contain `" Rd"` (with surrounding space).

Plus one **invariant check**: `PlaceOrderRequest.deliveryAddress` and the `confirmation-token` cart hash both still see the raw form (proven by reading the fields after `buildCallPrompt` returns — no mutation).

## 10. Files Modified

| File | Change |
|---|---|
| `src/lib/address-speech.ts` | New — exports `speakableAddress(raw)` plus internal tables |
| `src/connectors/bland.ts` | Line ~100: wrap `order.deliveryAddress` in `speakableAddress()` before XML wrap |
| `tests/address-speech.test.ts` | New — table-driven cases per the test plan |

## 11. Critical Constraints

- **Single apply site.** Do NOT call `speakableAddress` anywhere else (not in profile-store, not in confirmation-token, not in MCP tool params).
- **Raw stored.** Do NOT mutate `default_address`, `deliveryAddress`, or any persistent field.
- **No silent breakage.** If a regex doesn't match, return the segment unchanged. Never throw on unexpected input.
- **Conservative.** Add a token to the table only when high-confidence and unambiguous. We can grow the table over time; we cannot easily walk back a wrong replacement that already shipped to a real call.
- **Idempotent.** `speakableAddress(speakableAddress(x))` === `speakableAddress(x)` for all `x`. The output of one pass should not match the regexes of another pass.
