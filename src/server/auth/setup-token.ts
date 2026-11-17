import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * True when `given` equals `expected`, the setup token of the server's configuration
 * (WS-050). Both are hashed first, so the comparison always runs on two 32-byte values: it
 * takes the same time wherever they differ, and a value of another length neither throws
 * nor returns early. A missing or empty `given` never matches.
 */
export function setupTokenMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined || given === "") {
    return false;
  }
  return timingSafeEqual(digest(expected), digest(given));
}
