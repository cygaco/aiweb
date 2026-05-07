# Granular Stories — Menu + Delivery Discovery

Implementation-level stories. Each is verifiable in isolation. Heading format `### GS-MENU-DEL-NN: ...` matches `scripts/requirements/graph-build.js` parser.

---

### GS-MENU-DEL-01: Add `website?: string` to Restaurant type

**File:** `src/data/restaurants.ts`

**Depends on:** none

**Description:** Add optional `website?: string` field to the `Restaurant` interface. No fixture changes required — new field is optional. Existing restaurants without it pass type-check unchanged.

**Verifiable by:** `npm run build` passes.

**Parallel-safe:** yes

---

### GS-MENU-DEL-02: Populate `website` in places.ts from `places.websiteUri`

**File:** `src/connectors/places.ts`

**Depends on:** GS-MENU-DEL-01

**Description:** Extend `FIELD_MASK` to include `places.websiteUri`. Populate `website` on the returned `Restaurant` from `place.websiteUri` when present (else leave `undefined`). Add `websiteUri?: string` to the `RawPlace` type.

**Verifiable by:** unit test in `tests/places.test.ts` (if exists) or manual curl with a Places API key showing `website` in the mapped restaurant. Build passes.

**Parallel-safe:** yes (independent of menu-discovery.ts)

---

### GS-MENU-DEL-03: Module skeleton + types in `menu-discovery.ts`

**File:** `src/lib/menu-discovery.ts` (new)

**Depends on:** GS-MENU-DEL-01

**Description:** Create the module with:
- `export interface EnrichmentResult { restaurant: Restaurant; ran: boolean; source: 'restaurant_website' | 'cache_hit' | 'skipped' | 'failed'; reason: string; durationMs: number; discoveredAt: string | null; }`
- `export async function enrichRestaurant(restaurant: Restaurant, intent: string | undefined, opts?: { timeoutMs?: number; cacheDir?: string; bypassCache?: boolean }): Promise<EnrichmentResult>` — stub returning `{ ran: false, source: 'skipped', reason: 'not implemented' }`
- Local helpers: `sanitizeId(id: string): string` (replaces non-alphanumeric with `_`), `cachePathFor(id, dir): string`

**Verifiable by:** import in another file works; type-check passes.

**Parallel-safe:** yes

---

### GS-MENU-DEL-04: Implement cache read with TTL + freshness

**File:** `src/lib/menu-discovery.ts`

**Depends on:** GS-MENU-DEL-03

**Description:** Add internal `readCache(id, dir, ttlMs): { restaurant: Restaurant; discoveredAt: string } | null`. Reads `<dir>/<sanitizeId(id)>.json`. Parses `{ enriched, discoveredAt, version }`. If `version !== 1`, miss. If `Date.now() - parse(discoveredAt) > ttlMs`, miss. If file missing or parse fails, miss (no throw). TTL default 7 days; configurable via `MENU_CACHE_TTL_DAYS` env (parsed as integer days). When `bypassCache: true`, the function is not called.

**Verifiable by:** unit test: write a fixture cache file, read, assert. Write a stale one (discoveredAt subtracted 8 days), assert null. Write a malformed one, assert null.

**Parallel-safe:** yes

---

### GS-MENU-DEL-05: Implement fetch with abort timeout

**File:** `src/lib/menu-discovery.ts`

**Depends on:** GS-MENU-DEL-03

**Description:** Add internal `fetchHtml(url, timeoutMs): Promise<{ html: string; status: number } | { error: string }>`. Uses `AbortController` to enforce timeout. User-Agent header set to `PizzaConcierge/1.0 (compatibility check; +https://agentsforall.co)`. Returns `{ error }` on non-200, on >500KB body, on timeout, on network error. Truncates body at 200KB before returning (HTML extraction doesn't need more).

**Verifiable by:** unit test mocking `globalThis.fetch`. Cases: 200 with body, 404, network error throw, AbortError on timeout.

**Parallel-safe:** yes

---

### GS-MENU-DEL-06: Implement Claude HTML→menu+delivery extraction

**File:** `src/lib/menu-discovery.ts`

**Depends on:** GS-MENU-DEL-05

**Description:** Add internal `extractFromHtml(html, intent): Promise<{ menu: Restaurant['menu']; serviceType?: Restaurant['serviceType']; deliveryRadius?: number | null; rawEvidence: string } | { error: string }>`.

Uses the project's existing Anthropic SDK import (find via grep `@anthropic-ai/sdk` in src/). Model: `claude-haiku-4-5-20251001`. Max tokens 1500.

Prompt (system + user):
```
You are extracting structured restaurant data from a webpage HTML body for a pizza-ordering bot.

The user's pizza intent is: "<intent>". Extract:
1. Pizza menu items (focus on whole pizzas, not slices). Include name, optional description, and sizes with prices when visible.
2. Delivery information. Look for: "we deliver", "pickup only", "no delivery", radius mentions like "deliver within 5 miles", ZIP code lists, "third-party only" / "DoorDash" / "Uber Eats" mentions.

Return STRICT JSON only — no narrative, no markdown fences. Schema:
{
  "menu": { "pizzas": [{"name": str, "description"?: str, "sizes"?: [{"name": str, "price": number}]}], "sides": [] },
  "delivery": { "availability": "delivers"|"pickup_only"|"third_party_only"|"unknown", "radiusMiles": number|null, "zips": str[]|null },
  "evidence": "<one-sentence summary of where in the page you found this>"
}

If you cannot find a real structured menu (only nav links, only generic "we have pizza" text, only images), return menu.pizzas = [] and evidence describing why.

HTML:
<<<
<truncated-html>
>>>
```

Parse the response with `JSON.parse`. On parse failure, return `{ error: 'json parse failed' }`. On `pizzas.length === 0` AND `delivery.availability === 'unknown'`, return `{ error: 'no useful evidence extracted' }`. Otherwise normalize to `Restaurant['menu']` shape (sides = `[]` if missing) + return delivery info.

**Verifiable by:** unit test mocking the Anthropic SDK client. Cases: well-formed JSON response, malformed response, empty-pizzas-empty-delivery response, valid response with delivery cues.

**Parallel-safe:** yes

---

### GS-MENU-DEL-07: Implement cache write

**File:** `src/lib/menu-discovery.ts`

**Depends on:** GS-MENU-DEL-04, GS-MENU-DEL-06

**Description:** Add internal `writeCache(id, dir, payload): void`. Creates `dir` recursively if missing (`fs.mkdirSync(dir, { recursive: true })`). Writes `<dir>/<sanitizeId(id)>.json` with `{ version: 1, restaurantId: id, discoveredAt: <ISO now>, enriched: <Restaurant>, evidence: <string ≤2KB truncated> }`. All errors caught and logged to `console.error('[menu-discovery] cache write failed:', err.message)` — never throw.

**Verifiable by:** unit test: write to a temp dir, read back, assert structure. Write to a non-writable path, assert no throw + console.error called.

**Parallel-safe:** yes

---

### GS-MENU-DEL-08: Implement `enrichRestaurant` orchestration

**File:** `src/lib/menu-discovery.ts`

**Depends on:** GS-MENU-DEL-04, GS-MENU-DEL-05, GS-MENU-DEL-06, GS-MENU-DEL-07

**Description:** Replace the stub from GS-MENU-DEL-03 with the real implementation:

```ts
export async function enrichRestaurant(restaurant, intent, opts = {}) {
  const start = Date.now();
  const dir = opts.cacheDir ?? path.join(process.cwd(), 'runtime', 'menu-cache');
  const timeoutMs = opts.timeoutMs ?? Number(process.env.ENRICH_TIMEOUT_MS) ?? 4000;
  const ttlDays = Number(process.env.MENU_CACHE_TTL_DAYS) ?? 7;
  const ttlMs = ttlDays * 86400 * 1000;

  // Skip Domino's — already truthful via provider adapter
  if (restaurant.id.startsWith('dominos_')) {
    return { restaurant, ran: false, source: 'skipped', reason: 'dominos adapter handled', durationMs: Date.now() - start, discoveredAt: null };
  }

  // Skip if no website
  if (!restaurant.website || !/^https?:\/\//.test(restaurant.website)) {
    return { restaurant, ran: false, source: 'skipped', reason: 'no website url', durationMs: Date.now() - start, discoveredAt: null };
  }

  // Cache hit?
  if (!opts.bypassCache) {
    const hit = readCache(restaurant.id, dir, ttlMs);
    if (hit) {
      return { restaurant: hit.restaurant, ran: true, source: 'cache_hit', reason: 'fresh cache', durationMs: Date.now() - start, discoveredAt: hit.discoveredAt };
    }
  }

  // Fetch
  const fetched = await fetchHtml(restaurant.website, timeoutMs);
  if ('error' in fetched) {
    return { restaurant, ran: true, source: 'failed', reason: `fetch: ${fetched.error}`, durationMs: Date.now() - start, discoveredAt: null };
  }

  // Extract
  const extracted = await extractFromHtml(fetched.html, intent ?? '');
  if ('error' in extracted) {
    return { restaurant, ran: true, source: 'failed', reason: `extract: ${extracted.error}`, durationMs: Date.now() - start, discoveredAt: null };
  }

  // Build enriched restaurant — only overwrite if we got real values
  const enriched = { ...restaurant };
  if (extracted.menu.pizzas.length > 0) enriched.menu = extracted.menu;
  if (extracted.serviceType && extracted.serviceType !== 'unknown') enriched.serviceType = extracted.serviceType;
  if (typeof extracted.deliveryRadius === 'number' && extracted.deliveryRadius > 0) enriched.deliveryRadius = extracted.deliveryRadius;

  const now = new Date().toISOString();
  writeCache(restaurant.id, dir, { enriched, evidence: extracted.rawEvidence });

  return { restaurant: enriched, ran: true, source: 'restaurant_website', reason: 'enriched', durationMs: Date.now() - start, discoveredAt: now };
}
```

Total budget enforced via timeout in fetch. The Claude call is not separately timed (it has its own SDK-level timeout); if the user sets `ENRICH_TIMEOUT_MS`, treat that as the fetch budget specifically. Total wall-clock can exceed `timeoutMs` by Claude's response time — acceptable for v1.

**Verifiable by:** unit tests in GS-MENU-DEL-12 cover all branches.

**Parallel-safe:** no (depends on prior stories)

---

### GS-MENU-DEL-09: Flip generic-template item state in compatibility.ts

**File:** `src/lib/compatibility.ts`

**Depends on:** none (independent)

**Description:** In `checkItemAvailability`, the `isPlaces && match` branch currently returns `state: 'likely_available'` with confidence 0.6. Change to:

```ts
return {
  state: 'unknown',
  confidence: 0.4,
  source: 'places_generic_menu',
  reason: 'Generic Places menu — not real evidence.',
  nextStep: `Menu unknown — run discovery or call to confirm: 'Do you carry ${intentStyle}?'`,
};
```

The `isPlaces && !match` branch (no match in generic) keeps its existing shape but update reason for consistency: `"${intentStyle}" not in generic 3-item menu — real menu unknown until discovery runs.` Real-menu branches (test_*, dominos_*) unchanged.

**Verifiable by:** unit test (GS-MENU-DEL-13).

**Parallel-safe:** yes

---

### GS-MENU-DEL-10: Wire enrichment into `start_pizza_order` (server.ts)

**File:** `src/server.ts`

**Depends on:** GS-MENU-DEL-08, GS-MENU-DEL-09

**Description:** In the `start_pizza_order` handler (around line 646 where `assessCompatibility` is called per-restaurant), after the initial sort by verdict, locate top-1 candidate. If `process.env.ENRICH_COUNT === '0'`, skip enrichment. Otherwise, if top-1's `compatibility.overall === 'caution'` AND (`item.state === 'unknown'` OR `coverage.state === 'unknown'`), `await enrichRestaurant(top1, intent_style)`. Take the returned enriched restaurant, re-run `assessCompatibility(enriched, userLat, userLng, intent_style)`, replace top-1's `compatibility` with the new value, and add `enrichment: { ran, source, durationMs, reason }` to the top-1 entry. Re-sort the candidate list (verdict may have changed). Log `EVT-enrichment` event via `logEvent` (existing logger).

Top-2..N candidates left untouched in v1 (config flag `ENRICH_COUNT` allows raising this later — implementation note: read `ENRICH_COUNT` as int, default 1, enrich top-N where N >= 1).

**Verifiable by:** integration test (manual `npm run dev` + curl) — see test plan §8 in PRD. Plus event entry visible in `runtime/events.jsonl`.

**Parallel-safe:** no (depends on -08 and -09)

---

### GS-MENU-DEL-11: Wire enrichment into A2A `proposed_cart` (executor.ts)

**File:** `src/a2a/executor.ts`

**Depends on:** GS-MENU-DEL-08, GS-MENU-DEL-09

**Description:** Symmetric to GS-MENU-DEL-10. Find the path that emits the `proposed_cart` artifact + calls `assessCompatibility`. Insert the same enrichment hook before the gate decision: if caution due to item-unknown or coverage-unknown, enrich, re-assess, attach `enrichment` block to the artifact metadata.

**Verifiable by:** A2A test panel manual flow — see PRD §6 Beat 2.

**Parallel-safe:** no (depends on -08 and -09)

---

### GS-MENU-DEL-12: Tests for menu-discovery module

**File:** `tests/menu-discovery.test.ts` (new)

**Depends on:** GS-MENU-DEL-08

**Description:** Cover all branches:
1. Domino's restaurant → `{source:'skipped', reason:'dominos adapter handled'}`, no fetch called
2. Restaurant without website → `{source:'skipped', reason:'no website url'}`, no fetch called
3. Cache hit (fresh) → `{source:'cache_hit'}`, no fetch called, returns cached enriched
4. Cache hit (stale, >ttlMs old) → fetch path runs, cache miss handled
5. Cache miss → fetch 200 → Claude valid JSON with pizzas → `{source:'restaurant_website'}`, cache written
6. Fetch timeout (AbortError) → `{source:'failed', reason:'fetch: ...timeout'}`, original restaurant returned
7. Fetch returns 404 → `{source:'failed', reason:'fetch: status 404'}`
8. Fetch returns >500KB body → `{source:'failed', reason:'fetch: body too large'}`
9. Claude returns malformed JSON → `{source:'failed', reason:'extract: json parse failed'}`
10. Claude returns valid JSON with pizzas=[] AND delivery=unknown → `{source:'failed', reason:'extract: no useful evidence extracted'}`
11. `bypassCache: true` → cache read skipped even if fresh, fetch runs
12. Cache directory missing → `writeCache` creates it
13. Cache write fs error → caught, console.error called, function still returns success result with `discoveredAt` set

Mock all `fetch` calls and the Anthropic SDK client. Use `node:fs/promises` mocks or a temp dir for cache I/O (whichever is cleaner with the existing test pattern in `tests/`).

**Verifiable by:** `npm test` — all new tests pass.

**Parallel-safe:** yes

---

### GS-MENU-DEL-13: Update one assertion in tests/compatibility.test.ts

**File:** `tests/compatibility.test.ts`

**Depends on:** GS-MENU-DEL-09

**Description:** Find the test asserting `places_generic_menu` match returns `likely_available`. Update assertion to `unknown` per AC9. Existing 17 other tests stay unchanged. The test name may also need a one-line update for clarity ("places generic menu match returns likely_available" → "places generic menu match returns unknown — generic is not evidence").

**Verifiable by:** `npm test` — 105/105 → 105/105 (no regression, just label change).

**Parallel-safe:** yes

---

### GS-MENU-DEL-14: Smoke test on local server

**Files:** none (manual)

**Depends on:** GS-MENU-DEL-10, GS-MENU-DEL-11, GS-MENU-DEL-12, GS-MENU-DEL-13

**Description:** Run `npm run build` clean. Run `npm test` clean. Run `npm run dev` (or local MCP launcher). Invoke `start_pizza_order` with `address: "1 Market St, San Francisco, CA 94105"` + `intent_style: "pepperoni"`. Verify:
- A `places_*` candidate appears in response
- That candidate has `enrichment: { ran: true, source: 'restaurant_website' | 'failed' | 'cache_hit', ... }`
- If `restaurant_website`, the candidate's `compatibility.item.source` is `menu_match` (not `places_generic_menu`)
- A second invocation of the same flow shows `source: 'cache_hit'` for the same restaurant
- `runtime/menu-cache/places_<id>.json` exists with `discoveredAt`, `enriched`, `evidence`
- `runtime/events.jsonl` has new `EVT-enrichment` lines

**Verifiable by:** manual observation; not gauntlet-checkable.

**Parallel-safe:** no (last verification step)

---

## Dependency graph (linear-ish)

```
01 ─┬─ 02 (places.ts wires website)
    └─ 03 ─ 04 (cache read)
          ─ 05 (fetch)
          ─ 06 (extract) ─┬─ 07 (cache write) ─ 08 (orchestrator) ─┬─ 10 (server wire)
                                                                    └─ 11 (a2a wire)
09 (compat label flip) ─────────────────────────────────────────────┤
                                                                    └─ 12 (module tests)
13 (compat test update) ───────────────────────────────────────────┤
                                                                    └─ 14 (smoke)
```

01, 02, 03, 09, 13 can run in parallel as foundation. 04/05/06/07 are sequential within `menu-discovery.ts`. 10/11 wire-in sequential after 08. 12 can be written in parallel with 08 (mocks). 14 is the final manual verification.

## Notes for Builder

- Maintain HYGIENE: no `// TODO` comments, no `// removed X` comments, no narrative docstrings beyond one short line. Comments only where the WHY is non-obvious (e.g., "Domino's adapter handled" — yes, that's why we skip).
- The new module exports ONE function publicly. Helpers stay non-exported.
- TypeScript strict mode. No `any` unless the SDK forces it.
- Tests use the same framework already in `tests/` (likely Node's built-in test runner — confirm by reading one existing test file).
- Use `paths.X` keys in Markdown docs (we just added a new feature folder + new code paths; if `paths.json` has registry entries for `runtime/menu-cache` consider adding one — defer to compliance gate).
- Do NOT regenerate `places.ts` mock menu — it's still the fallback when enrichment fails.
- Do NOT modify `dominos.ts` — provider adapter is already truthful.
- Do NOT modify `compatibility.ts` outside the specific branch in AC9 — the gate's output type contract is frozen.
