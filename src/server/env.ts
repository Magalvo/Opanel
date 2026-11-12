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
const envSchema = z.object({
  NODE_ENV: z
    .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(", ")}` })
    .default("development"),
  DATABASE_URL: z
    .string({ error: "required" })
    .min(1, { error: "required" })
    .refine(isPostgresUrl, { error: "must be a postgres:// or postgresql:// URL" }),
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

export function createEnvAccessor(readSource: () => EnvSource): () => Env {
  let cached: Env | undefined;
  return () => {
    cached ??= parseEnv(readSource());
    return cached;
  };
}

/** The validated server configuration. The only place `process.env` is read. */
export const getEnv = createEnvAccessor(() => process.env);
