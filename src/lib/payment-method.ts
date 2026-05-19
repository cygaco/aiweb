/**
 * src/lib/payment-method.ts — SP-20260519-006 R-1.
 *
 * Shared zod schemas + type predicates for the alpha-stage
 * card-over-phone payment branch. Used by:
 *
 *   - src/server.ts place_order tool input
 *   - src/a2a/executor.ts confirmed=true path
 *
 * Two surfaces, one schema = no drift. Drift between them is a leak
 * vector (RT-201 echo). All fields are runtime-validated; TypeScript
 * narrowing via `isCardOverPhone(req)` predicate.
 *
 * NOTHING IN THIS MODULE PERSISTS CARD DETAILS. The values flow
 * caller → zod parse → PlaceOrderRequest → Bland prompt body. The
 * transcript that comes back is scrubbed before it lands anywhere
 * (R-3); the secret-guard hook is the write-time backstop (R-5);
 * ENABLE_CARD_OVER_PHONE env gate refuses the path entirely when off
 * (R-6).
 */

import { z } from "zod";

export const PAYMENT_METHODS = ["cash_on_delivery", "card_over_phone"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Card-number: 13–19 digits, optionally grouped 4-4-4-4 with spaces or dashes.
// Format validation only — no Luhn (payment-processor's job). The 13–19 range
// covers Visa, Mastercard, Amex, Discover, Diners, Maestro.
const cardNumberRegex = /^[\d\s-]{13,23}$/;

const cardExpRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;
const cardCvvRegex = /^\d{3,4}$/;
const cardZipRegex = /^\d{5}(-\d{4})?$/;

/**
 * Card-branch fields. Required together when payment_method='card_over_phone'.
 */
export const cardOverPhoneFieldsSchema = z.object({
  card_number: z
    .string()
    .regex(cardNumberRegex, "invalid_card_number")
    .refine(
      (s) =>
        s.replace(/[\s-]/g, "").length >= 13 &&
        s.replace(/[\s-]/g, "").length <= 19,
      "invalid_card_number_length",
    ),
  card_exp: z.string().regex(cardExpRegex, "invalid_card_exp"),
  card_cvv: z.string().regex(cardCvvRegex, "invalid_card_cvv"),
  card_zip: z.string().regex(cardZipRegex, "invalid_card_zip"),
  tip_percent: z.number().min(0).max(30).optional(),
});

/**
 * Discriminated-union schema for the payment_method field on place_order
 * input. Surfaces import this and `.parse()` on the relevant slice of
 * their request body.
 */
export const paymentMethodInputSchema = z.discriminatedUnion("payment_method", [
  z.object({
    payment_method: z.literal("cash_on_delivery"),
  }),
  z
    .object({
      payment_method: z.literal("card_over_phone"),
    })
    .merge(cardOverPhoneFieldsSchema),
]);

export type PaymentMethodInput = z.infer<typeof paymentMethodInputSchema>;

/**
 * Loose helper for callers who only want to test the method tag without
 * forcing the full discriminated parse (e.g. agent prompt branching).
 */
export const paymentMethodEnumSchema = z.enum(PAYMENT_METHODS).optional();

/**
 * Type predicate. Lets downstream code narrow:
 *   if (isCardOverPhone(req)) { req.cardNumber // typed as string }
 */
export function isCardOverPhone(req: {
  paymentMethod?: PaymentMethod;
  cardNumber?: string;
  cardExp?: string;
  cardCvv?: string;
  cardZip?: string;
}): req is typeof req & {
  paymentMethod: "card_over_phone";
  cardNumber: string;
  cardExp: string;
  cardCvv: string;
  cardZip: string;
} {
  return (
    req.paymentMethod === "card_over_phone" &&
    typeof req.cardNumber === "string" &&
    typeof req.cardExp === "string" &&
    typeof req.cardCvv === "string" &&
    typeof req.cardZip === "string"
  );
}

/**
 * Default tip when card branch + caller didn't override.
 */
export const DEFAULT_TIP_PERCENT = 15;

/**
 * Server-side env-gate check. Returns true ONLY when the env is exactly
 * the string 'true' — every other value (unset, '1', 'yes', empty) means
 * disabled. R-6.
 */
export function isCardOverPhoneEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ENABLE_CARD_OVER_PHONE === "true";
}
