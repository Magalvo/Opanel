import { hash, verify } from "@node-rs/argon2";

import { hashGate } from "./hash-gate";

// OWASP minimum profile for Argon2id. Every hash records its own parameters, so these
// can be raised later without invalidating existing hashes.
const OPTIONS = {
  algorithm: 2, // Argon2id: the const enum Algorithm cannot be imported under isolatedModules
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Through the hash gate (WS-056): rejects with `429 server_busy` when it is full. */
export function hashPassword(password: string): Promise<string> {
  return hashGate.run(() => hash(password, OPTIONS));
}

/**
 * False for a wrong password and for a hash that cannot be parsed. Through the hash gate
 * (WS-056): rejects with `429 server_busy` when it is full, so a busy server never looks
 * like a wrong password; never throws otherwise.
 */
export function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  return hashGate.run(async () => {
    try {
      return await verify(input.hash, input.password);
    } catch {
      return false;
    }
  });
}
