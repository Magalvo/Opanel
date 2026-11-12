import { describe, expect, it } from "vitest";

import { createEnvAccessor, EnvValidationError, parseEnv, productionWarnings } from "./env";

const validUrl = "postgres://opanel:opanel@localhost:5432/opanel";
const validSecret = "test-secret-test-secret-test-secret-0123";
const validAppUrl = "http://localhost:3000";
const base = {
  DATABASE_URL: validUrl,
  BETTER_AUTH_SECRET: validSecret,
  APP_URL: validAppUrl,
};

function captureError(source: Record<string, string | undefined>): EnvValidationError {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("returns typed values for a valid record", () => {
    const env = parseEnv({ ...base, NODE_ENV: "production" });

    expect(env).toEqual({ ...base, NODE_ENV: "production" });
  });

  it("defaults NODE_ENV to development", () => {
    const env = parseEnv(base);

    expect(env.NODE_ENV).toBe("development");
  });

  it("accepts the postgresql scheme", () => {
    const url = "postgresql://opanel:opanel@localhost:5432/opanel";

    expect(parseEnv({ ...base, DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a missing DATABASE_URL and names it", () => {
    const error = captureError({ ...base, DATABASE_URL: undefined });

    expect(error.variables).toEqual(["DATABASE_URL"]);
    expect(error.message).toContain("DATABASE_URL: required");
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(captureError({ ...base, DATABASE_URL: "" }).variables).toEqual(["DATABASE_URL"]);
  });

  it("rejects a DATABASE_URL that is not a URL", () => {
    expect(captureError({ ...base, DATABASE_URL: "not a url" }).variables).toEqual([
      "DATABASE_URL",
    ]);
  });

  it("rejects a DATABASE_URL with a non-Postgres scheme", () => {
    const error = captureError({ ...base, DATABASE_URL: "mysql://user:pw@localhost:3306/db" });

    expect(error.variables).toEqual(["DATABASE_URL"]);
  });

  it("lists every invalid variable in a single error", () => {
    const error = captureError({ NODE_ENV: "staging" });

    expect(error.variables).toEqual(["APP_URL", "BETTER_AUTH_SECRET", "DATABASE_URL", "NODE_ENV"]);
    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).toContain("NODE_ENV: must be one of development, test, production");
    expect(error.message).toContain(".env.example");
  });

  it("never includes a rejected value in the error message", () => {
    const error = captureError({
      ...base,
      NODE_ENV: "staging-secret-mode",
      BETTER_AUTH_SECRET: "short-secret-value",
      APP_URL: "ftp://internal.example/secret-path",
      DATABASE_URL: "mysql://admin:sup3r-s3cret@db.internal:3306/prod",
    });

    expect(error.message).not.toContain("sup3r-s3cret");
    expect(error.message).not.toContain("db.internal");
    expect(error.message).not.toContain("staging-secret-mode");
    expect(error.message).not.toContain("short-secret-value");
    expect(error.message).not.toContain("secret-path");
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(parseEnv(base))).toBe(true);
  });
});

describe("BETTER_AUTH_SECRET", () => {
  it.each([undefined, "", "x".repeat(31)])("rejects %j and names the variable", (value) => {
    const error = captureError({ ...base, BETTER_AUTH_SECRET: value });

    expect(error.variables).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("accepts 32 characters", () => {
    expect(parseEnv({ ...base, BETTER_AUTH_SECRET: "x".repeat(32) }).BETTER_AUTH_SECRET).toBe(
      "x".repeat(32),
    );
  });

  it("is never shown in the error message", () => {
    const error = captureError({ ...base, BETTER_AUTH_SECRET: "weak-and-private" });

    expect(error.message).toContain("BETTER_AUTH_SECRET");
    expect(error.message).not.toContain("weak-and-private");
  });
});

describe("APP_URL", () => {
  it.each([undefined, "", "ftp://app.example", "not a url"])("rejects %j", (value) => {
    expect(captureError({ ...base, APP_URL: value }).variables).toEqual(["APP_URL"]);
  });

  it.each(["http://localhost:3000", "https://opanel.example"])("accepts %s", (value) => {
    expect(parseEnv({ ...base, APP_URL: value }).APP_URL).toBe(value);
  });
});

describe("CLIENT_IP_HEADER", () => {
  it("is optional", () => {
    expect(parseEnv(base).CLIENT_IP_HEADER).toBeUndefined();
  });

  it("treats an empty value as not set", () => {
    expect(parseEnv({ ...base, CLIENT_IP_HEADER: "" }).CLIENT_IP_HEADER).toBeUndefined();
  });

  it.each(["x-forwarded-for", "CF-Connecting-IP"])("accepts the header name %s", (value) => {
    expect(parseEnv({ ...base, CLIENT_IP_HEADER: value }).CLIENT_IP_HEADER).toBe(value);
  });

  it.each(["bad header!", "x forwarded", "a:b"])("rejects %j and names the variable", (value) => {
    expect(captureError({ ...base, CLIENT_IP_HEADER: value }).variables).toEqual([
      "CLIENT_IP_HEADER",
    ]);
  });
});

describe("productionWarnings", () => {
  it("warns when production has no CLIENT_IP_HEADER, naming the variable", () => {
    const warnings = productionWarnings({ NODE_ENV: "production", CLIENT_IP_HEADER: undefined });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLIENT_IP_HEADER");
    expect(warnings[0]).toContain("per email only");
  });

  it("is silent when the header is configured", () => {
    expect(
      productionWarnings({ NODE_ENV: "production", CLIENT_IP_HEADER: "x-forwarded-for" }),
    ).toEqual([]);
  });

  it.each(["development", "test"] as const)("is silent in %s", (NODE_ENV) => {
    expect(productionWarnings({ NODE_ENV, CLIENT_IP_HEADER: undefined })).toEqual([]);
  });
});

describe("createEnvAccessor", () => {
  it("parses once and returns the same object on later calls", () => {
    let reads = 0;
    const getEnv = createEnvAccessor(() => {
      reads += 1;
      return base;
    });

    const first = getEnv();
    const second = getEnv();

    expect(second).toBe(first);
    expect(reads).toBe(1);
  });

  it("does not read the source until first called", () => {
    let reads = 0;
    createEnvAccessor(() => {
      reads += 1;
      return base;
    });

    expect(reads).toBe(0);
  });
});
