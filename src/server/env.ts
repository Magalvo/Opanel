import { z } from "zod";

const NODE_ENVS = ["development", "test", "production"] as const;

function isPostgresUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const { protocol } = new URL(value);
  return protocol === "postgres:" || protocol === "postgresql:";
}

// Messages are written by hand and never interpolate the rejected value:
// environment variables hold secrets (AGENTS.md hard rule 7).
function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

const HEADER_NAME = /^[A-Za-z0-9-]+$/;

const nodeEnvSchema = z
  .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(", ")}` })
  .default("development");

const POSTGRES_URL_ERROR = "must be a postgres:// or postgresql:// URL";

/** An optional postgres URL; an empty value means not set. */
const optionalPostgresUrl = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .refine((value) => value === undefined || isPostgresUrl(value), { error: POSTGRES_URL_ERROR });

/**
 * `BETTER_AUTH_SECRET` values published in this repository (WS-112). Anyone can read them,
 * so a production server refuses them; development and tests use them on purpose.
 */
const PUBLISHED_AUTH_SECRETS: ReadonlySet<string> = new Set([
  "change-me-local-development-secret-0123456789", // .env.example
  "test-secret-only-for-vitest-0123456789abcdef", // .env.test
]);

const PUBLISHED_AUTH_SECRET_ERROR =
  "is an example value published with Opanel; generate one with `openssl rand -base64 32`";

const envFieldsSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: z
    .string({ error: "required" })
    .min(1, { error: "required" })
    .refine(isPostgresUrl, { error: POSTGRES_URL_ERROR }),
  // The schema owner's connection, for `migrate` only (WS-063). Optional: without it,
  // `migrate` uses DATABASE_URL, which is then the owner too. Never logged.
  MIGRATION_DATABASE_URL: optionalPostgresUrl,
  // Signs and encrypts sessions. Read by Better Auth through getEnv(), never logged.
  BETTER_AUTH_SECRET: z
    .string({ error: "required" })
    .min(32, { error: "required, at least 32 characters" }),
  // The app's own origin, used for Better Auth's base URL and the origin check.
  APP_URL: z
    .string({ error: "required" })
    .min(1, { error: "required" })
    .refine(isHttpUrl, { error: "must be an http:// or https:// URL" }),
  // Name of the request header in which Opanel's own reverse proxy puts the client address,
  // for example `x-forwarded-for`. Optional: when it is not set, the sign-in limiter works
  // per email only, and failed API token attempts are not limited per address (WS-125),
  // because no header is trusted to be genuine.
  CLIENT_IP_HEADER: z
    .string()
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .refine((value) => value === undefined || HEADER_NAME.test(value), {
      error: "must be an HTTP header name, for example x-forwarded-for",
    }),
  // Optional secret that the first-run setup asks for (WS-050), so a fresh install cannot be
  // claimed by whoever reaches it first. Empty means not set. Never logged.
  SETUP_TOKEN: z
    .string()
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .refine((value) => value === undefined || (value.length >= 32 && value.length <= 256), {
      error: "must be 32 to 256 characters",
    }),
});

const envSchema = envFieldsSchema.superRefine((env, ctx) => {
  // Zod 4 runs this even when a field failed, with that field's raw value (WS-112). A
  // missing or invalid secret is never in the set, so it is reported by its field only.
  if (env.NODE_ENV === "production" && PUBLISHED_AUTH_SECRETS.has(env.BETTER_AUTH_SECRET)) {
    ctx.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_SECRET"],
      message: PUBLISHED_AUTH_SECRET_ERROR,
    });
  }
});

export type Env = Readonly<z.infer<typeof envSchema>>;

/**
 * What `migrate` reads, and nothing else (WS-079): in production it receives only the
 * owner's connection, never the app's secrets. In development it falls back to
 * DATABASE_URL, as before.
 */
const migrationEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    DATABASE_URL: optionalPostgresUrl,
    MIGRATION_DATABASE_URL: optionalPostgresUrl,
  })
  .refine((env) => env.MIGRATION_DATABASE_URL !== undefined || env.DATABASE_URL !== undefined, {
    error: "required (or DATABASE_URL)",
    path: ["MIGRATION_DATABASE_URL"],
  });

export type MigrationEnv = Readonly<{
  NODE_ENV: Env["NODE_ENV"];
  DATABASE_URL?: string | undefined;
  MIGRATION_DATABASE_URL?: string | undefined;
}>;

const MISSING_MIGRATION_URL = new Map([["MIGRATION_DATABASE_URL", "required (or DATABASE_URL)"]]);

/** The connection `migrate` uses: the schema owner's when it is set apart (WS-063). */
export function migrationDatabaseUrl(env: MigrationEnv): string {
  const url = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
  if (url === undefined) {
    throw new EnvValidationError(MISSING_MIGRATION_URL);
  }
  return url;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class EnvValidationError extends Error {
  readonly variables: readonly string[];

  constructor(problems: ReadonlyMap<string, string>) {
    const names = [...problems.keys()].sort();
    const lines = names.map((name) => `  - ${name}: ${problems.get(name) ?? "invalid"}`);
    super(["Invalid environment configuration:", ...lines, "See .env.example."].join("\n"));
    this.name = "EnvValidationError";
    this.variables = names;
  }
}

function validationError(error: z.ZodError): EnvValidationError {
  const problems = new Map<string, string>();
  for (const issue of error.issues) {
    const name = String(issue.path[0] ?? "(root)");
    if (!problems.has(name)) {
      problems.set(name, issue.message);
    }
  }
  return new EnvValidationError(problems);
}

export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return Object.freeze(result.data);
  }
  throw validationError(result.error);
}

/** Validates only what `migrate` reads (WS-079). */
export function parseMigrationEnv(source: EnvSource): MigrationEnv {
  const result = migrationEnvSchema.safeParse(source);
  if (result.success) {
    return Object.freeze(result.data);
  }
  throw validationError(result.error);
}

/**
 * Things an operator should know about a production configuration that is valid but weaker
 * than it could be. Printed once at startup; never a reason to stop the server.
 */
export function productionWarnings(env: Pick<Env, "NODE_ENV" | "CLIENT_IP_HEADER">): string[] {
  if (env.NODE_ENV !== "production") {
    return [];
  }
  const warnings: string[] = [];
  if (env.CLIENT_IP_HEADER === undefined) {
    warnings.push(
      "CLIENT_IP_HEADER is not set: sign-in attempts are limited per email only, not per " +
        "client address, and failed API token attempts are not limited. Run Opanel behind a " +
        "reverse proxy and set CLIENT_IP_HEADER to the header in which that proxy puts the client address. See .env.example.",
    );
  }
  return warnings;
}

export function createEnvAccessor(readSource: () => EnvSource): () => Env {
  let cached: Env | undefined;
  return () => {
    cached ??= parseEnv(readSource());
    return cached;
  };
}

/**
 * The validated server configuration. With `getMigrationEnv` and `getNodeEnv`, the only
 * readers of `process.env`.
 */
export const getEnv = createEnvAccessor(() => process.env);

/** The validated configuration of `migrate`, which needs none of the app's secrets. */
export function getMigrationEnv(): MigrationEnv {
  return parseMigrationEnv(process.env);
}

/**
 * `NODE_ENV` alone, validated like the full configuration, for code that runs on every
 * request and must not need the rest: the proxy (WS-041).
 */
export function parseNodeEnv(source: EnvSource): Env["NODE_ENV"] {
  const result = nodeEnvSchema.safeParse(source.NODE_ENV);
  if (result.success) {
    return result.data;
  }
  throw new EnvValidationError(new Map([["NODE_ENV", result.error.issues[0]?.message ?? ""]]));
}

/** The validated `NODE_ENV`. */
export function getNodeEnv(): Env["NODE_ENV"] {
  return parseNodeEnv(process.env);
}
