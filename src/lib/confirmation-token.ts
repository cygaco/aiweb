import crypto from "node:crypto";

const HMAC_KEY_INFO = "aiweb:confirmation-token:v1";
const TOKEN_TTL_MS = 10 * 60 * 1000;

export interface TokenArgs {
  restaurant_id: string;
  items: { name: string; size: string; quantity: number; price: number }[];
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  token_hash?: string;
}

interface TokenPayload extends Omit<TokenArgs, "items"> {
  items_hash: string;
  ts: number;
}

function deriveKey(): Buffer {
  const secret = process.env.PROFILE_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "PROFILE_ENCRYPTION_SECRET required for confirmation-token signing",
    );
  }
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(secret, "hex"),
      Buffer.alloc(0),
      HMAC_KEY_INFO,
      32,
    ),
  );
}

function hashItems(items: TokenArgs["items"]): string {
  const canon = items
    .map((i) => ({
      name: i.name,
      size: i.size,
      quantity: i.quantity,
      price: i.price,
    }))
    .sort((a, b) => (a.name + a.size).localeCompare(b.name + b.size));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canon))
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function issueToken(args: TokenArgs): string {
  const payload: TokenPayload = {
    restaurant_id: args.restaurant_id,
    items_hash: hashItems(args.items),
    customer_name: args.customer_name,
    customer_phone: args.customer_phone,
    delivery_address: args.delivery_address,
    token_hash: args.token_hash,
    ts: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", deriveKey())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyToken(token: string, args: TokenArgs): VerifyResult {
  const dot = token.indexOf(".");
  if (dot < 0) return { ok: false, reason: "malformed token" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto
    .createHmac("sha256", deriveKey())
    .update(body)
    .digest("base64url");
  if (!safeEqual(sig, expectedSig))
    return { ok: false, reason: "signature mismatch" };
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return { ok: false, reason: "payload not parseable" };
  }
  if (Date.now() - payload.ts > TOKEN_TTL_MS)
    return { ok: false, reason: "token expired" };
  if (payload.restaurant_id !== args.restaurant_id)
    return { ok: false, reason: "restaurant_id mismatch" };
  if (payload.items_hash !== hashItems(args.items))
    return { ok: false, reason: "items mismatch" };
  if (payload.customer_name !== args.customer_name)
    return { ok: false, reason: "customer_name mismatch" };
  if (payload.customer_phone !== args.customer_phone)
    return { ok: false, reason: "customer_phone mismatch" };
  if (payload.delivery_address !== args.delivery_address)
    return { ok: false, reason: "delivery_address mismatch" };
  if ((payload.token_hash ?? null) !== (args.token_hash ?? null))
    return { ok: false, reason: "session mismatch" };
  return { ok: true };
}
