import { describe, expect, it } from "vitest";

import {
  createEnvAccessor,
  EnvValidationError,
  migrationDatabaseUrl,
  parseEnv,
  parseMigrationEnv,
  parseNodeEnv,
  productionWarnings,
} from "./env";

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

describe("SETUP_TOKEN (WS-050)", () => {
  const token = "s".repeat(32);

  it("is optional", () => {
    expect(parseEnv(base).SETUP_TOKEN).toBeUndefined();
  });

  it("treats an empty value as not set", () => {
    expect(parseEnv({ ...base, SETUP_TOKEN: "" }).SETUP_TOKEN).toBeUndefined();
  });

  it.each([32, 256])("accepts %i characters", (length) => {
    const value = "t".repeat(length);
    expect(parseEnv({ ...base, SETUP_TOKEN: value }).SETUP_TOKEN).toBe(value);
  });

  it.each([31, 257])("rejects %i characters, naming the variable but never the value", (length) => {
    const value = `marker-${"m".repeat(length - 7)}`;
    const error = captureError({ ...base, SETUP_TOKEN: value });

    expect(error.variables).toEqual(["SETUP_TOKEN"]);
    expect(error.message).toContain("32 to 256 characters");
    expect(error.message).not.toContain("marker-");
  });

  it("keeps the configured token as it is", () => {
    expect(parseEnv({ ...base, SETUP_TOKEN: token }).SETUP_TOKEN).toBe(token);
  });
});

describe("MIGRATION_DATABASE_URL (WS-063)", () => {
  it("is optional, and an empty value means not set", () => {
    expect(parseEnv(base).MIGRATION_DATABASE_URL).toBeUndefined();
    expect(
      parseEnv({ ...base, MIGRATION_DATABASE_URL: "" }).MIGRATION_DATABASE_URL,
    ).toBeUndefined();
  });

  it("accepts a postgres URL", () => {
    const url = "postgres://owner:pw@db:5432/opanel";
    expect(parseEnv({ ...base, MIGRATION_DATABASE_URL: url }).MIGRATION_DATABASE_URL).toBe(url);
  });

  it("is what migrate connects with, and DATABASE_URL when it is not set", () => {
    const owner = "postgres://owner:pw@db:5432/opanel";
    expect(migrationDatabaseUrl(parseEnv({ ...base, MIGRATION_DATABASE_URL: owner }))).toBe(owner);
    expect(migrationDatabaseUrl(parseEnv(base))).toBe(base.DATABASE_URL);
  });

  it("rejects anything else, naming the variable but never the value", () => {
    const error = captureError({ ...base, MIGRATION_DATABASE_URL: "mysql://marker-secret@db" });

    expect(error.variables).toEqual(["MIGRATION_DATABASE_URL"]);
    expect(error.message).toContain("postgres:// or postgresql:// URL");
    expect(error.message).not.toContain("marker-secret");
  });
});

describe("parseMigrationEnv (WS-079)", () => {
  const owner = "postgres://owner:pw@db:5432/opanel";

  function captureMigrationError(source: Record<string, string | undefined>): EnvValidationError {
    try {
      parseMigrationEnv(source);
    } catch (error) {
      if (error instanceof EnvValidationError) {
        return error;
      }
      throw error;
    }
    throw new Error("expected parseMigrationEnv to throw");
  }

  it("needs only the owner's connection: no BETTER_AUTH_SECRET, APP_URL or DATABASE_URL", () => {
    const env = parseMigrationEnv({ MIGRATION_DATABASE_URL: owner });

    expect(migrationDatabaseUrl(env)).toBe(owner);
  });

  it("ignores the app's settings, even invalid ones", () => {
    const env = parseMigrationEnv({
      MIGRATION_DATABASE_URL: owner,
      BETTER_AUTH_SECRET: "short",
      APP_URL: "not a url",
    });

    expect(migrationDatabaseUrl(env)).toBe(owner);
  });

  it("falls back to DATABASE_URL, and treats an empty MIGRATION_DATABASE_URL as not set", () => {
    expect(migrationDatabaseUrl(parseMigrationEnv({ DATABASE_URL: validUrl }))).toBe(validUrl);
    expect(
      migrationDatabaseUrl(
        parseMigrationEnv({ DATABASE_URL: validUrl, MIGRATION_DATABASE_URL: "" }),
      ),
    ).toBe(validUrl);
  });

  it("validates NODE_ENV like the app", () => {
    expect(parseMigrationEnv({ DATABASE_URL: validUrl }).NODE_ENV).toBe("development");
    expect(
      captureMigrationError({ DATABASE_URL: validUrl, NODE_ENV: "staging" }).variables,
    ).toEqual(["NODE_ENV"]);
  });

  it("with neither connection, names MIGRATION_DATABASE_URL", () => {
    const error = captureMigrationError({ BETTER_AUTH_SECRET: validSecret, APP_URL: validAppUrl });

    expect(error.variables).toEqual(["MIGRATION_DATABASE_URL"]);
    expect(error.message).toContain("MIGRATION_DATABASE_URL");
  });

  it("rejects a non-postgres MIGRATION_DATABASE_URL, naming it but never its value", () => {
    const error = captureMigrationError({ MIGRATION_DATABASE_URL: "mysql://marker-secret@db" });

    expect(error.variables).toEqual(["MIGRATION_DATABASE_URL"]);
    expect(error.message).toContain("postgres:// or postgresql:// URL");
    expect(error.message).not.toContain("marker-secret");
  });

  it("rejects a non-postgres DATABASE_URL it would fall back to, never printing it", () => {
    const error = captureMigrationError({ DATABASE_URL: "mysql://marker-secret@db" });

    expect(error.variables).toEqual(["DATABASE_URL"]);
    expect(error.message).not.toContain("marker-secret");
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

describe("parseNodeEnv", () => {
  it("reads NODE_ENV alone, without needing the rest of the configuration", () => {
    expect(parseNodeEnv({ NODE_ENV: "production" })).toBe("production");
    expect(parseNodeEnv({ NODE_ENV: "test" })).toBe("test");
  });

  it("defaults to development, as parseEnv does", () => {
    expect(parseNodeEnv({})).toBe("development");
  });

  it("rejects an unknown value without echoing it", () => {
    expect(() => parseNodeEnv({ NODE_ENV: "staging-secret" })).toThrow(EnvValidationError);
    expect(() => parseNodeEnv({ NODE_ENV: "staging-secret" })).not.toThrow(/staging-secret/);
  });
});
