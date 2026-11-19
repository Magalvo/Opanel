import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateApiToken, parseBearer, secretMatches } from "./api-token";

const FORMAT = /^opk_([a-z2-7]{12})_([0-9a-f]{64})$/;

describe("generateApiToken (WS-072)", () => {
  it("returns a token of the format, its public id and the SHA-256 of its secret", () => {
    const { token, publicId, secretHash } = generateApiToken();
    const match = FORMAT.exec(token);

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(publicId);
    const secret = match?.[2] ?? "";
    expect(secretHash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(secretHash).not.toBe(secret);
  });

  it("never repeats a public id or a secret", () => {
    const tokens = Array.from({ length: 1000 }, () => generateApiToken());
    expect(new Set(tokens.map((t) => t.publicId)).size).toBe(1000);
    expect(new Set(tokens.map((t) => t.token.slice(17))).size).toBe(1000);
  });

  it("uses the whole alphabet of the public id", () => {
    const characters = new Set(
      Array.from({ length: 300 }, () => generateApiToken().publicId).join(""),
    );
    expect(characters.size).toBe(32);
  });
});

describe("parseBearer (WS-072)", () => {
  const { token, publicId } = generateApiToken();
  const secret = token.slice(17);

  it("reads a bearer token, the scheme in any case", () => {
    for (const scheme of ["Bearer", "bearer", "BEARER"]) {
      expect(parseBearer(`${scheme} ${token}`)).toEqual({ publicId, secret });
    }
  });

  it("refuses anything else", () => {
    const bad = [
      null,
      "",
      token,
      `Basic ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token} `,
      `Bearer ${token}x`,
      `Bearer opx_${token.slice(4)}`,
      `Bearer opk_${publicId.toUpperCase()}_${secret}`,
      `Bearer opk_${publicId.slice(1)}_${secret}`,
      `Bearer opk_${publicId}_${secret.slice(1)}`,
      `Bearer opk_${publicId}_${secret.toUpperCase()}`,
    ];
    for (const header of bad) expect(parseBearer(header), String(header)).toBeNull();
  });
});

describe("secretMatches (WS-072)", () => {
  it("is true only for the secret of the stored hash", () => {
    const one = generateApiToken();
    const other = generateApiToken();
    expect(secretMatches(one.token.slice(17), one.secretHash)).toBe(true);
    expect(secretMatches(other.token.slice(17), one.secretHash)).toBe(false);
  });
});
