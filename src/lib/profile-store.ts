import crypto from "node:crypto";
import Database from "better-sqlite3";

export interface UserProfile {
  name?: string;
  phone?: string;
  default_address?: string;
  dietary?: string;
  preferred_restaurant_id?: string;
  notes?: string;
  updated_at: string;
}

type ProfileData = Omit<UserProfile, "updated_at">;

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

const PROFILE_FIELDS: ReadonlyArray<keyof ProfileData> = [
  "name",
  "phone",
  "default_address",
  "dietary",
  "preferred_restaurant_id",
  "notes",
] as const;

let db: Database.Database | null = null;

export function initProfileStore(): void {
  const dbPath = process.env.DATABASE_PATH ?? "./profiles.db";
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      token_hash TEXT PRIMARY KEY,
      encrypted_blob BLOB,
      updated_at TEXT
    )
  `);
}

function getDb(): Database.Database {
  if (!db) {
    throw new Error(
      "Profile store not initialized. Call initProfileStore() first.",
    );
  }
  return db;
}

const HEX_64 = /^[0-9a-f]{64}$/i;

function deriveKey(tokenHash: string): Buffer {
  const secret = process.env.PROFILE_ENCRYPTION_SECRET;
  if (!secret) throw new Error("PROFILE_ENCRYPTION_SECRET not set");
  if (!HEX_64.test(secret)) {
    throw new Error(
      "PROFILE_ENCRYPTION_SECRET must be 64 hex chars (32 bytes). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (!HEX_64.test(tokenHash)) {
    throw new Error("tokenHash must be 64 hex chars (SHA-256 hex digest)");
  }
  const masterKey = Buffer.from(secret, "hex");
  const salt = Buffer.from(tokenHash, "hex");
  const info = Buffer.from("aiweb-profile-v1");
  return Buffer.from(crypto.hkdfSync("sha256", masterKey, salt, info, 32));
}

function encryptBlob(data: ProfileData, tokenHash: string): Buffer {
  const key = deriveKey(tokenHash);
  const plaintext = JSON.stringify(data);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(tokenHash, "hex"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]);
}

function decryptBlob(blob: Buffer, tokenHash: string): ProfileData {
  if (blob.length < 28) {
    throw new Error("profile blob too short to be valid ciphertext");
  }
  const key = deriveKey(tokenHash);
  const nonce = blob.slice(0, 12);
  const tag = blob.slice(blob.length - 16);
  const ct = blob.slice(12, blob.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(tokenHash, "hex"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ct),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as ProfileData;
}

export function getProfile(tokenHash: string): UserProfile {
  const database = getDb();
  const row = database
    .prepare(
      "SELECT encrypted_blob, updated_at FROM profiles WHERE token_hash = ?",
    )
    .get(tokenHash) as
    | { encrypted_blob: Buffer; updated_at: string }
    | undefined;

  if (!row) {
    return { updated_at: new Date().toISOString() };
  }

  try {
    const data = decryptBlob(row.encrypted_blob, tokenHash);
    return { ...data, updated_at: row.updated_at };
  } catch (err) {
    console.error("profile-store: decryption failed:", err);
    return { updated_at: new Date().toISOString() };
  }
}

export function updateProfile(
  tokenHash: string,
  partial: Partial<UserProfile>,
): UserProfile {
  if (partial.phone !== undefined && partial.phone !== "") {
    if (!E164_REGEX.test(partial.phone)) {
      throw new Error(
        "Invalid phone number. Must be E.164 format (e.g., +14155551234)",
      );
    }
  }

  const database = getDb();
  const existing = getProfile(tokenHash);
  const updated_at = new Date().toISOString();

  // Build merged record from existing data
  const acc: Record<string, string | undefined> = {};
  for (const field of PROFILE_FIELDS) {
    const val = existing[field];
    if (val !== undefined) acc[field] = val;
  }

  // Apply partial updates — empty string clears a field, undefined skips it
  for (const field of PROFILE_FIELDS) {
    if (!(field in partial)) continue;
    const val = partial[field];
    if (val === "") {
      delete acc[field];
    } else if (val !== undefined) {
      acc[field] = val;
    }
  }

  const dataToStore = acc as unknown as ProfileData;
  const blob = encryptBlob(dataToStore, tokenHash);

  database
    .prepare(
      "INSERT OR REPLACE INTO profiles (token_hash, encrypted_blob, updated_at) VALUES (?, ?, ?)",
    )
    .run(tokenHash, blob, updated_at);

  return { ...dataToStore, updated_at };
}
