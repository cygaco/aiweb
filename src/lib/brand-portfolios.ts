/**
 * Brand portfolios for drink suppression.
 *
 * Hardcoded constant — ~15 brand names across 4 portfolios.
 * Used by buildCustomizationSurface to suppress default DrinkOption entries
 * whose brand resolves to a portfolio conflicting with any real-drink portfolio
 * present on the restaurant.
 *
 * DD-3 (sprint SP-20260512-002): a static fact doesn't need LLM classification.
 * Suppression rule: if real drinks contain ≥1 entry whose brand resolves to
 * portfolio P, drop all defaults whose brand resolves to a portfolio Q ≠ P
 * (both P and Q ≠ "unknown"). Defaults with brand `undefined` (e.g. plain
 * Water) are never suppressed.
 */

export const BRAND_PORTFOLIOS = {
  coca_cola: [
    "Coca-Cola",
    "Coke",
    "Diet Coke",
    "Sprite",
    "Fanta",
    "Dasani",
    "Minute Maid",
  ],
  pepsi: [
    "Pepsi",
    "Diet Pepsi",
    "Mountain Dew",
    "Mtn Dew",
    "Sierra Mist",
    "Starry",
    "Aquafina",
    "Tropicana",
  ],
  regional: [] as string[], // populated on demand; brandToPortfolio returns 'unknown' for misses
  store_brand: ["Store Brand", "House Brand", "Restaurant Brand"],
} as const;

export type PortfolioId = keyof typeof BRAND_PORTFOLIOS | "unknown";

/**
 * Resolve a brand string to one of the four known portfolios.
 *
 * - Case-insensitive substring match. Either direction wins: brand contains
 *   a known token, OR a known token contains the brand. This handles
 *   "Pepsi Co." → 'pepsi' and "Coke" → 'coca_cola'.
 * - `undefined` returns 'unknown' (defaults whose brand is undefined are
 *   never suppressed by the surface).
 * - Unrecognized brands also return 'unknown'.
 */
export function brandToPortfolio(brand: string | undefined): PortfolioId {
  if (!brand) return "unknown";
  const normalized = brand.toLowerCase().trim();
  if (!normalized) return "unknown";

  for (const [portfolioId, brands] of Object.entries(BRAND_PORTFOLIOS) as [
    PortfolioId,
    readonly string[],
  ][]) {
    for (const candidate of brands) {
      const cand = candidate.toLowerCase();
      if (normalized.includes(cand) || cand.includes(normalized)) {
        return portfolioId;
      }
    }
  }
  return "unknown";
}
