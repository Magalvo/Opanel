import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Agents' API tokens (canonical doc 0001 section 4, WT-05 decision 3, WS-072):
// `opk_<publicId>_<secret>`. The public id finds the row; only the SHA-256 of the secret is
// stored. The secret has 256 bits of randomness, so a fast hash is enough.

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const TOKEN = /^opk_([a-z2-7]{12})_([0-9a-f]{64})$/;

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

export interface GeneratedApiToken {
  /** The full token, shown once to the Admin who creates it. Never stored or logged. */
  token: string;
  publicId: string;
  /** What `api_tokens.secret_hash` stores: the SHA-256 of the secret, as hex. */
  secretHash: string;
}

export function generateApiToken(): GeneratedApiToken {
  // 32 characters: `& 31` keeps every one equally likely.
  const publicId = Array.from(randomBytes(12), (byte) => PUBLIC_ID_ALPHABET[byte & 31]).join("");
  const secret = randomBytes(32).toString("hex");
  return {
    token: `opk_${publicId}_${secret}`,
    publicId,
    secretHash: sha256(secret).toString("hex"),
  };
}

/**
 * The parts of an `Authorization: Bearer <token>` header, or `null` for anything else. The
 * scheme name is case-insensitive (RFC 9110); the token itself is not.
 */
export function parseBearer(header: string | null): { publicId: string; secret: string } | null {
  if (header === null) return null;
  const space = header.indexOf(" ");
  if (space < 0 || header.slice(0, space).toLowerCase() !== "bearer") return null;
  const [, publicId, secret] = TOKEN.exec(header.slice(space + 1)) ?? [];
  if (publicId === undefined || secret === undefined) return null;
  return { publicId, secret };
}

/** Compares the secret with a stored hash in constant time. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const stored = Buffer.from(storedHash, "hex");
  const given = sha256(secret);
  return stored.length === given.length && timingSafeEqual(given, stored);
}
