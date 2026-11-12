import { Algorithm, hash, verify } from "@node-rs/argon2";

// OWASP minimum profile for Argon2id. Every hash records its own parameters, so these
// can be raised later without invalidating existing hashes.
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** False for a wrong password and for a hash that cannot be parsed; never throws. */
export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(input.hash, input.password);
  } catch {
    return false;
  }
}
