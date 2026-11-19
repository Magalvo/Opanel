// Checks a guide in docs/ against the repository (WS-070 section 5), shared by the tests of
// docs/operations.md and docs/agents.md (WS-078 section 5).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

export interface Repository {
  /** The runtime stage of the Dockerfile copies these `dist/*.mjs` commands. */
  readonly shippedCommands: ReadonlySet<string>;
  /** Variables the app reads and an env example describes, or the Compose file reads. */
  readonly knownVariables: ReadonlySet<string>;
  /** Whether a path, relative to the repository root, exists. */
  readonly exists: (path: string) => boolean;
}

const VARIABLE = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
const REPOSITORY_PATH =
  /^(?:(?:docs|scripts|src|docker|\.github)\/[^\s*<>{}]+|[\w.-]+\.(?:ya?ml|md|example|json)|Dockerfile)$/;

export function codeSpans(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

export function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```bash\r?\n([\s\S]*?)^```/gm)].map((match) => match[1] ?? "");
}

/** Every problem the guide has against the repository; empty when it is in step. */
export function guideProblems(guide: string, repository: Repository): string[] {
  const problems = new Set<string>();

  for (const match of guide.matchAll(/\bdist\/([\w-]+)\.mjs\b/g)) {
    const command = match[1] ?? "";
    if (!repository.shippedCommands.has(command)) {
      problems.add(`the image does not ship dist/${command}.mjs`);
    }
  }

  const variables = new Set<string>();
  for (const span of codeSpans(guide)) {
    const name = span.split("=")[0] ?? "";
    if (VARIABLE.test(name)) {
      variables.add(name);
    }
  }
  for (const block of bashBlocks(guide)) {
    for (const match of block.matchAll(/(?:^|\s)([A-Z][A-Z0-9]*_[A-Z0-9_]+)=/gm)) {
      variables.add(match[1] ?? "");
    }
  }
  for (const name of variables) {
    if (!repository.knownVariables.has(name)) {
      problems.add(`unknown variable ${name}`);
    }
  }

  for (const span of codeSpans(guide)) {
    if (REPOSITORY_PATH.test(span) && !repository.exists(span)) {
      problems.add(`missing file ${span}`);
    }
  }
  for (const match of guide.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = (match[1] ?? "").split("#")[0] ?? "";
    if (target === "" || /^[a-z]+:/.test(target)) {
      continue;
    }
    const path = join("docs", target).replaceAll("\\", "/");
    if (!repository.exists(path)) {
      problems.add(`broken link ${target}`);
    }
  }

  return [...problems];
}

export function sectionHeadings(guide: string): string[] {
  return [...guide.matchAll(/^## (.+)$/gm)].map((match) => (match[1] ?? "").trim());
}

export function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

export function thisRepository(): Repository {
  const dockerfile = read("Dockerfile");
  const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
  const shippedCommands = new Set(
    [...runtime.matchAll(/\/app\/dist\/([\w-]+)\.mjs/g)].map((match) => match[1] ?? ""),
  );

  // The keys of the env schema, read from its source: the app does not export it.
  const envSource = read("src/server/env.ts");
  const schema = envSource.slice(envSource.indexOf("const envSchema"));
  const appVariables = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]*): z/gm)].map(
    (match) => match[1] ?? "",
  );
  const examples = read(".env.example") + read(".env.production.example");
  const compose = read("compose.production.yaml");
  const composeVariables = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map(
    (match) => match[1] ?? "",
  );
  // Read by PostgreSQL's image and its init script, from the same env file as the app.
  const databaseVariables = ["POSTGRES_PASSWORD", "OPANEL_APP_DB_PASSWORD"].filter((name) =>
    examples.includes(`${name}=`),
  );

  return {
    shippedCommands,
    knownVariables: new Set([
      ...appVariables.filter((name) => examples.includes(name)),
      ...composeVariables,
      ...databaseVariables,
    ]),
    exists: (path) => existsSync(join(ROOT, path)),
  };
}
