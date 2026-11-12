import { describe, expect, it } from "vitest";

import { createEnvAccessor, EnvValidationError, parseEnv } from "./env";

const validUrl = "postgres://opanel:opanel@localhost:5432/opanel";

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
    const env = parseEnv({ NODE_ENV: "production", DATABASE_URL: validUrl });

    expect(env).toEqual({ NODE_ENV: "production", DATABASE_URL: validUrl });
  });

  it("defaults NODE_ENV to development", () => {
    const env = parseEnv({ DATABASE_URL: validUrl });

    expect(env.NODE_ENV).toBe("development");
  });

  it("accepts the postgresql scheme", () => {
    const url = "postgresql://opanel:opanel@localhost:5432/opanel";

    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a missing DATABASE_URL and names it", () => {
    const error = captureError({ NODE_ENV: "test" });

    expect(error.variables).toEqual(["DATABASE_URL"]);
    expect(error.message).toContain("DATABASE_URL: required");
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(captureError({ DATABASE_URL: "" }).variables).toEqual(["DATABASE_URL"]);
  });

  it("rejects a DATABASE_URL that is not a URL", () => {
    expect(captureError({ DATABASE_URL: "not a url" }).variables).toEqual(["DATABASE_URL"]);
  });

  it("rejects a DATABASE_URL with a non-Postgres scheme", () => {
    const error = captureError({ DATABASE_URL: "mysql://user:pw@localhost:3306/db" });

    expect(error.variables).toEqual(["DATABASE_URL"]);
  });

  it("lists every invalid variable in a single error", () => {
    const error = captureError({ NODE_ENV: "staging" });

    expect(error.variables).toEqual(["DATABASE_URL", "NODE_ENV"]);
    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).toContain("NODE_ENV: must be one of development, test, production");
    expect(error.message).toContain(".env.example");
  });

  it("never includes a rejected value in the error message", () => {
    const error = captureError({
      NODE_ENV: "staging-secret-mode",
      DATABASE_URL: "mysql://admin:sup3r-s3cret@db.internal:3306/prod",
    });

    expect(error.message).not.toContain("sup3r-s3cret");
    expect(error.message).not.toContain("db.internal");
    expect(error.message).not.toContain("staging-secret-mode");
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(parseEnv({ DATABASE_URL: validUrl }))).toBe(true);
  });
});

describe("createEnvAccessor", () => {
  it("parses once and returns the same object on later calls", () => {
    let reads = 0;
    const getEnv = createEnvAccessor(() => {
      reads += 1;
      return { DATABASE_URL: validUrl };
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
      return { DATABASE_URL: validUrl };
    });

    expect(reads).toBe(0);
  });
});
