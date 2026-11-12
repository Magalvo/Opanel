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

const envSchema = z.object({
  NODE_ENV: z
    .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(", ")}` })
    .default("development"),
  DATABASE_URL: z
    .string({ error: "required" })
    .min(1, { error: "required" })
    .refine(isPostgresUrl, { error: "must be a postgres:// or postgresql:// URL" }),
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
  // per email only, because no header is trusted to be genuine.
  CLIENT_IP_HEADER: z
    .string()
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .refine((value) => value === undefined || HEADER_NAME.test(value), {
      error: "must be an HTTP header name, for example x-forwarded-for",
    }),
});

export type Env = Readonly<z.infer<typeof envSchema>>;

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

export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return Object.freeze(result.data);
  }

  const problems = new Map<string, string>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? "(root)");
    if (!problems.has(name)) {
      problems.set(name, issue.message);
    }
  }
  throw new EnvValidationError(problems);
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
        "client address. Run Opanel behind a reverse proxy and set CLIENT_IP_HEADER to the " +
        "header in which that proxy puts the client address. See .env.example.",
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

/** The validated server configuration. The only place `process.env` is read. */
export const getEnv = createEnvAccessor(() => process.env);
