// Test isolation between Git worktrees (WS-095). Each linked worktree gets an ID, used in
// the names of its test databases and in its end-to-end ports, so several worktrees can run
// the quality gate at the same time. The main checkout and CI have no ID: today's names and
// ports. Test infrastructure only; nothing in the app imports it.
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKTREE_VARIABLE = "OPANEL_WORKTREE";

const ID_RULE = /^[a-z0-9]{1,16}$/;

type Environment = Readonly<Record<string, string | undefined>>;

/** The root of the checkout this file belongs to, whatever the current directory. */
export function checkoutRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

/**
 * The ID of a path: the first 8 hex characters of the SHA-256 of the resolved path. On
 * Windows the path is lower-cased first, since `C:\x` and `c:\X` are the same folder.
 */
export function pathWorktreeId(
  folder: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = platform === "win32" ? path.win32.resolve(folder) : path.posix.resolve(folder);
  const normalised = platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(normalised).digest("hex").slice(0, 8);
}

/**
 * `OPANEL_WORKTREE` when set; otherwise, in a linked worktree (whose `.git` is a file), the
 * ID of its path; otherwise (main checkout, CI) none.
 */
export function worktreeId(
  root: string = checkoutRoot(),
  env: Environment = process.env,
): string | undefined {
  const chosen = env[WORKTREE_VARIABLE];
  if (chosen !== undefined && chosen !== "") {
    if (!ID_RULE.test(chosen)) {
      throw new Error(`${WORKTREE_VARIABLE} must be 1 to 16 lower-case letters or digits.`);
    }
    return chosen;
  }
  const git = statSync(path.join(root, ".git"), { throwIfNoEntry: false });
  return git?.isFile() === true ? pathWorktreeId(root) : undefined;
}

const SUFFIXES = ["_e2e_test", "_test"] as const;

/**
 * The same URL with the ID before the database name's suffix: `opanel_test` becomes
 * `opanel_<id>_test`, `opanel_e2e_test` becomes `opanel_<id>_e2e_test`. Unchanged without
 * an ID, when the ID is already there, or when the name has no test suffix (the guards
 * refuse it later).
 */
export function worktreeDatabaseUrl(url: string, id: string | undefined): string {
  if (id === undefined || !URL.canParse(url)) {
    return url;
  }
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  const suffix = SUFFIXES.find((candidate) => name.endsWith(candidate));
  if (suffix === undefined || name.endsWith(`_${id}${suffix}`)) {
    return url;
  }
  parsed.pathname = `/${name.slice(0, -suffix.length)}_${id}${suffix}`;
  return parsed.toString();
}

export interface PortChoice {
  /** The variable that sets the port, for example E2E_PORT. */
  readonly variable: string;
  /** The port without an ID: today's. */
  readonly fallback: number;
  /** With an ID, the port is base + (ID mod 1000). */
  readonly base: number;
}

function idNumber(id: string): number {
  const hex = /^[0-9a-f]{1,8}$/.test(id)
    ? id
    : createHash("sha256").update(id).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16);
}

/** The port of an end-to-end run: the variable, else from the ID, else the fixed port. */
export function e2ePort(
  choice: PortChoice,
  id: string | undefined,
  env: Environment = process.env,
): number {
  const value = env[choice.variable];
  if (value !== undefined && value !== "") {
    const port = Number(value);
    if (!/^\d+$/.test(value) || port < 1024 || port > 65535) {
      throw new Error(`${choice.variable} must be an integer from 1024 to 65535.`);
    }
    return port;
  }
  return id === undefined ? choice.fallback : choice.base + (idNumber(id) % 1000);
}

/** Rejects when something already accepts connections on the port of localhost. */
export async function assertPortFree(port: number, variable: string): Promise<void> {
  const inUse = await new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: "localhost", autoSelectFamily: true });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
  if (inUse) {
    throw new Error(
      `Port ${String(port)} is already in use, probably by another end-to-end run. ` +
        `Set ${variable} to a free port.`,
    );
  }
}
