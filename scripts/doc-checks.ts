// Checks a guide in docs/ against the repository (WS-070 section 5), shared by the tests of
// docs/operations.md and docs/agents.md (WS-078 section 5), and the index in
// docs/README.md against the docs themselves (WS-096 section 5).
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  const schema = envSource.slice(
    envSource.indexOf("const envSchema"),
    envSource.indexOf("export type Env ="),
  );
  const appVariables = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map(
    (match) => match[1] ?? "",
  );
  const examples = read(".env.example") + read(".env.production.example");
  // The example install is the short file and the services it includes (WS-079), which
  // name every variable a service receives, the database's among them.
  const compose = read("compose.production.yaml") + read("docker/production/services.yaml");
  const composeVariables = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map(
    (match) => match[1] ?? "",
  );

  return {
    shippedCommands,
    knownVariables: new Set([
      ...appVariables.filter((name) => examples.includes(name)),
      ...composeVariables,
    ]),
    exists: (path) => existsSync(join(ROOT, path)),
  };
}

/** A doc of the spec system: its path relative to `docs/`, and its text. */
export interface DocFile {
  readonly path: string;
  readonly content: string;
}

const DOC_DIRECTORIES = {
  canonical: { name: /^(\d{4})-[a-z0-9-]+\.md$/, form: "NNNN-slug.md" },
  "work-tracks": { name: /^(WT-\d{2})-[a-z0-9-]+\.md$/, form: "WT-NN-slug.md" },
  "work-items": { name: /^(WI-\d{3})-[a-z0-9-]+\.md$/, form: "WI-NNN-slug.md" },
  "work-specs": { name: /^(WS-\d{3})-[a-z0-9-]+\.md$/, form: "WS-NNN-slug.md" },
} as const;

type DocDirectory = keyof typeof DOC_DIRECTORIES;

const STATUSES = ["Draft", "Proposed", "Approved", "In progress", "Done", "Superseded"];

const INDEX_LINK = /\]\(((?:canonical|work-tracks|work-items|work-specs)\/[^)\s#]+\.md)\)/g;

function directoryOf(path: string): DocDirectory | undefined {
  const directory = path.split("/")[0] ?? "";
  return directory in DOC_DIRECTORIES ? (directory as DocDirectory) : undefined;
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? "";
}

/** The doc's number as the index shows it (`0001`, `WT-01`, `WI-001`), if it is well named. */
function numberOf(path: string): string | undefined {
  const directory = directoryOf(path);
  return directory ? DOC_DIRECTORIES[directory].name.exec(fileName(path))?.[1] : undefined;
}

/** The first word of the doc's `Status:` line, bold marks aside; undefined if it has none. */
function statusOf(content: string): string | undefined {
  const line = /^- Status: (.*)$/m.exec(content)?.[1];
  if (line === undefined) return undefined;
  return /^\**([A-Za-z]+(?: progress)?)/.exec(line)?.[1] ?? line;
}

function hasStatusColumn(index: string): boolean {
  const lines = index.split(/\r?\n/);
  return lines.some(
    (line, i) =>
      line.startsWith("|") &&
      /^\|[\s|:-]+\|$/.test((lines[i + 1] ?? "").trim()) &&
      line.split("|").some((cell) => /status/i.test(cell)),
  );
}

/** Every problem the index has against the docs; empty when it is in step (WS-096). */
export function indexProblems(index: string, docs: readonly DocFile[]): string[] {
  const problems: string[] = [];
  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  const itemStatus = new Map<string, string | undefined>();
  for (const doc of docs) {
    const number = numberOf(doc.path);
    if (directoryOf(doc.path) === "work-items" && number) {
      itemStatus.set(number.slice(3), statusOf(doc.content));
    }
  }

  if (hasStatusColumn(index)) {
    problems.push("the index has a status column");
  }

  const rows = new Map<string, number>();
  for (const line of index.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    for (const match of line.matchAll(INDEX_LINK)) {
      const path = match[1] ?? "";
      rows.set(path, (rows.get(path) ?? 0) + 1);
    }
  }
  for (const path of rows.keys()) {
    if (byPath.has(path)) continue;
    // A reserved item links to its work-spec before the work-spec is written.
    const number = numberOf(path);
    const status = number ? itemStatus.get(number.slice(3)) : undefined;
    if (directoryOf(path) === "work-specs" && (status === "Draft" || status === "Proposed")) {
      continue;
    }
    problems.push(`the index links to ${path}, which does not exist`);
  }

  for (const doc of docs) {
    const count = rows.get(doc.path) ?? 0;
    if (count === 0) problems.push(`${doc.path} has no row in the index`);
    if (count > 1) problems.push(`${doc.path} has ${String(count)} rows in the index`);

    const status = statusOf(doc.content);
    if (status === undefined) problems.push(`${doc.path} has no Status line`);
    else if (!STATUSES.includes(status)) {
      problems.push(`${doc.path} has the status "${status}"`);
    }
  }

  for (const doc of docs) {
    const number = numberOf(doc.path);
    if (directoryOf(doc.path) === "work-specs" && number && !itemStatus.has(number.slice(3))) {
      problems.push(`${doc.path} has no work-item`);
    }
  }

  const users = new Map<string, number>();
  for (const doc of docs) {
    const number = numberOf(doc.path);
    if (number) users.set(number, (users.get(number) ?? 0) + 1);
  }
  for (const [number, count] of users) {
    if (count > 1) problems.push(`${number} is used by ${String(count)} docs`);
  }
  for (const doc of docs) {
    const directory = directoryOf(doc.path);
    if (directory && numberOf(doc.path) === undefined) {
      problems.push(`${doc.path} is not named ${DOC_DIRECTORIES[directory].form}`);
    }
  }

  return problems;
}

/** The docs of the four directories in this repository, templates aside. */
export function thisRepositoryDocs(): DocFile[] {
  return Object.keys(DOC_DIRECTORIES).flatMap((directory) =>
    readdirSync(join(ROOT, "docs", directory))
      .filter((name) => name.endsWith(".md") && name !== "_TEMPLATE.md")
      .sort()
      .map((name) => {
        const path = `${directory}/${name}`;
        return { path, content: read(join("docs", path)) };
      }),
  );
}
