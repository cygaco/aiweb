/**
 * Menu taxonomy — string-literal types aligned with Google's FoodMenu
 * schema (`developers.google.com/my-business/reference/rest/v4/FoodMenus`).
 *
 * SP-20260517-005 / R-8. See the survey at
 * `.claude/project/reference/google-menu-apis-survey-2026-05.md` for
 * why we chose this taxonomy (no public Google menu API exists for
 * third-party reads; aligning the cache schema future-proofs us if a
 * partner-program read endpoint ever opens).
 *
 * All exports here are types + value-level enum guards. No runtime
 * behavior. Consumers should treat unknown enum values as "drop the
 * entry and log a TR-1 anomaly" rather than coercing.
 */

/** Top-level cuisine taxonomy. Subset of Google's `Cuisine` enum — extend as needed. */
export type Cuisine =
  | "AMERICAN"
  | "BBQ"
  | "CHINESE"
  | "FRENCH"
  | "GREEK"
  | "INDIAN"
  | "ITALIAN"
  | "JAPANESE"
  | "KOREAN"
  | "MEDITERRANEAN"
  | "MEXICAN"
  | "PIZZA"
  | "SEAFOOD"
  | "STEAK"
  | "SUSHI"
  | "THAI"
  | "VEGAN"
  | "VEGETARIAN"
  | "OTHER";

export const CUISINE_VALUES: readonly Cuisine[] = [
  "AMERICAN",
  "BBQ",
  "CHINESE",
  "FRENCH",
  "GREEK",
  "INDIAN",
  "ITALIAN",
  "JAPANESE",
  "KOREAN",
  "MEDITERRANEAN",
  "MEXICAN",
  "PIZZA",
  "SEAFOOD",
  "STEAK",
  "SUSHI",
  "THAI",
  "VEGAN",
  "VEGETARIAN",
  "OTHER",
] as const;

export function isCuisine(v: unknown): v is Cuisine {
  return (
    typeof v === "string" && (CUISINE_VALUES as readonly string[]).includes(v)
  );
}

/** FDA top-8 allergen taxonomy, aligned with Google FoodMenu `Allergen`. */
export type Allergen =
  | "DAIRY"
  | "EGG"
  | "FISH"
  | "PEANUT"
  | "SHELLFISH"
  | "SOY"
  | "TREE_NUT"
  | "WHEAT";

export const ALLERGEN_VALUES: readonly Allergen[] = [
  "DAIRY",
  "EGG",
  "FISH",
  "PEANUT",
  "SHELLFISH",
  "SOY",
  "TREE_NUT",
  "WHEAT",
] as const;

export function isAllergen(v: unknown): v is Allergen {
  return (
    typeof v === "string" && (ALLERGEN_VALUES as readonly string[]).includes(v)
  );
}

/** Dietary restriction taxonomy, aligned with Google FoodMenu `DietaryRestriction`. */
export type DietaryRestriction =
  | "HALAL"
  | "KOSHER"
  | "ORGANIC"
  | "VEGAN"
  | "VEGETARIAN";

export const DIETARY_RESTRICTION_VALUES: readonly DietaryRestriction[] = [
  "HALAL",
  "KOSHER",
  "ORGANIC",
  "VEGAN",
  "VEGETARIAN",
] as const;

export function isDietaryRestriction(v: unknown): v is DietaryRestriction {
  return (
    typeof v === "string" &&
    (DIETARY_RESTRICTION_VALUES as readonly string[]).includes(v)
  );
}

/** Spiciness taxonomy. Aligned with Google FoodMenu `Spiciness`. */
export type Spiciness = "MILD" | "MEDIUM" | "HOT";

export const SPICINESS_VALUES: readonly Spiciness[] = [
  "MILD",
  "MEDIUM",
  "HOT",
] as const;

export function isSpiciness(v: unknown): v is Spiciness {
  return (
    typeof v === "string" && (SPICINESS_VALUES as readonly string[]).includes(v)
  );
}

/** Preparation method taxonomy. Subset of Google FoodMenu `PreparationMethod`. */
export type PreparationMethod =
  | "BAKED"
  | "FRIED"
  | "GRILLED"
  | "ROASTED"
  | "STEAMED";

export const PREPARATION_METHOD_VALUES: readonly PreparationMethod[] = [
  "BAKED",
  "FRIED",
  "GRILLED",
  "ROASTED",
  "STEAMED",
] as const;

export function isPreparationMethod(v: unknown): v is PreparationMethod {
  return (
    typeof v === "string" &&
    (PREPARATION_METHOD_VALUES as readonly string[]).includes(v)
  );
}

/** Ingredient — minimal shape aligned with Google FoodMenu `Ingredient`. */
export interface Ingredient {
  name: string;
}

export function isIngredient(v: unknown): v is Ingredient {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { name?: unknown }).name === "string"
  );
}

/**
 * R-8 attribute bag — the additive optional fields a real menu item
 * may carry. Reused on PizzaMenuItem, MenuItem (sides), Drink, etc.
 *
 * All fields optional. Validators (e.g. isValidCachedMenuResult) MUST
 * accept entries that omit this bag entirely (back-compat with existing
 * cache files) and MUST reject entries where an array slot contains a
 * value outside the enum (catches drift early — better than silently
 * coercing to "OTHER").
 */
export interface FoodMenuAttributes {
  allergen?: Allergen[];
  dietaryRestriction?: DietaryRestriction[];
  spiciness?: Spiciness;
  preparationMethods?: PreparationMethod[];
  ingredients?: Ingredient[];
}

/** Validate a FoodMenuAttributes payload (additive). Returns true if absent OR well-shaped. */
export function isValidFoodMenuAttributes(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (obj.allergen !== undefined) {
    if (!Array.isArray(obj.allergen)) return false;
    if (obj.allergen.length > 8) return false;
    if (!obj.allergen.every(isAllergen)) return false;
  }
  if (obj.dietaryRestriction !== undefined) {
    if (!Array.isArray(obj.dietaryRestriction)) return false;
    if (obj.dietaryRestriction.length > 5) return false;
    if (!obj.dietaryRestriction.every(isDietaryRestriction)) return false;
  }
  if (obj.spiciness !== undefined) {
    if (!isSpiciness(obj.spiciness)) return false;
  }
  if (obj.preparationMethods !== undefined) {
    if (!Array.isArray(obj.preparationMethods)) return false;
    if (obj.preparationMethods.length > 5) return false;
    if (!obj.preparationMethods.every(isPreparationMethod)) return false;
  }
  if (obj.ingredients !== undefined) {
    if (!Array.isArray(obj.ingredients)) return false;
    if (obj.ingredients.length > 20) return false;
    if (!obj.ingredients.every(isIngredient)) return false;
  }
  return true;
}

/**
 * Validate a top-level `cuisines` field on a menu (additive). Returns true
 * when absent (back-compat) or when present + a well-shaped array of valid
 * Cuisine values bounded to 5 entries.
 */
export function isValidCuisines(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (!Array.isArray(v)) return false;
  if (v.length > 5) return false;
  return v.every(isCuisine);
}
