import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertPortFree,
  e2ePort,
  pathWorktreeId,
  worktreeDatabaseUrl,
  worktreeId,
} from "./worktree";

describe("worktreeId", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), "opanel-worktree-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function checkout(name: string, git: "directory" | "file" | "none"): string {
    const root = path.join(base, name);
    mkdirSync(root);
    if (git === "directory") {
      mkdirSync(path.join(root, ".git"));
    } else if (git === "file") {
      writeFileSync(path.join(root, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    }
    return root;
  }

  it("gives the main checkout, whose .git is a directory, no ID", () => {
    expect(worktreeId(checkout("main", "directory"), {})).toBeUndefined();
  });

  it("gives a copy without Git no ID", () => {
    expect(worktreeId(checkout("copy", "none"), {})).toBeUndefined();
  });

  it("gives a linked worktree, whose .git is a file, 8 hex characters from its path", () => {
    const root = checkout("linked", "file");
    const id = worktreeId(root, {});
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(worktreeId(root, {})).toBe(id);
    expect(id).toBe(pathWorktreeId(root));
  });

  it("gives two worktrees two IDs", () => {
    expect(worktreeId(checkout("one", "file"), {})).not.toBe(
      worktreeId(checkout("two", "file"), {}),
    );
  });

  it("ignores the case of the path on Windows only", () => {
    expect(pathWorktreeId("C:\\Work\\Opanel", "win32")).toBe(
      pathWorktreeId("c:\\work\\opanel", "win32"),
    );
    expect(pathWorktreeId("C:/Work/Opanel", "win32")).toBe(
      pathWorktreeId("c:\\work\\opanel", "win32"),
    );
    expect(pathWorktreeId("/work/Opanel", "linux")).not.toBe(
      pathWorktreeId("/work/opanel", "linux"),
    );
  });

  it("takes OPANEL_WORKTREE when it is set, in any checkout", () => {
    expect(worktreeId(checkout("main", "directory"), { OPANEL_WORKTREE: "wi095" })).toBe("wi095");
    expect(worktreeId(checkout("linked", "file"), { OPANEL_WORKTREE: "abc" })).toBe("abc");
  });

  it("treats an empty OPANEL_WORKTREE as not set", () => {
    expect(worktreeId(checkout("main", "directory"), { OPANEL_WORKTREE: "" })).toBeUndefined();
  });

  it.each(["Upper", "with-dash", "x".repeat(17), "a b"])(
    "refuses OPANEL_WORKTREE=%j, naming the variable and not the value",
    (value) => {
      const call = (): unknown => worktreeId(checkout("main", "directory"), { OPANEL_WORKTREE: value });
      expect(call).toThrow(/OPANEL_WORKTREE must be 1 to 16 lower-case letters or digits/);
      try {
        call();
      } catch (error) {
        expect(error instanceof Error ? error.message : "").not.toContain(value);
      }
    },
  );
});

describe("worktreeDatabaseUrl", () => {
  const id = "3f9a07c2";

  it("puts the ID before the _test suffix", () => {
    expect(worktreeDatabaseUrl("postgres://opanel:opanel@localhost:5432/opanel_test", id)).toBe(
      "postgres://opanel:opanel@localhost:5432/opanel_3f9a07c2_test",
    );
  });

  it("puts the ID before the _e2e_test suffix", () => {
    expect(
      worktreeDatabaseUrl("postgres://opanel:opanel@localhost:5432/opanel_e2e_test", id),
    ).toBe("postgres://opanel:opanel@localhost:5432/opanel_3f9a07c2_e2e_test");
  });

  it("keeps the host, port, credentials and query", () => {
    expect(
      worktreeDatabaseUrl("postgresql://u:p%40ss@db.local:5433/opanel_test?sslmode=disable", id),
    ).toBe("postgresql://u:p%40ss@db.local:5433/opanel_3f9a07c2_test?sslmode=disable");
  });

  it("changes nothing when applied twice", () => {
    const once = worktreeDatabaseUrl("postgres://opanel:opanel@localhost:5432/opanel_e2e_test", id);
    expect(worktreeDatabaseUrl(once, id)).toBe(once);
  });

  it("changes nothing without an ID", () => {
    const url = "postgres://opanel:opanel@localhost:5432/opanel_test";
    expect(worktreeDatabaseUrl(url, undefined)).toBe(url);
  });

  it("leaves a name that does not end in _test for the guards to refuse", () => {
    const url = "postgres://opanel:opanel@localhost:5432/opanel";
    expect(worktreeDatabaseUrl(url, id)).toBe(url);
  });
});

describe("e2ePort", () => {
  const app = { variable: "E2E_PORT", fallback: 3100, base: 20000 };

  it("keeps the fixed port without an ID", () => {
    expect(e2ePort(app, undefined, {})).toBe(3100);
  });

  it("derives a port in the range of the run from the ID", () => {
    expect(e2ePort(app, "000003e9", {})).toBe(20001);
    expect(e2ePort({ variable: "X", fallback: 3200, base: 21000 }, "000003e9", {})).toBe(21001);
  });

  it("hashes an ID that is not hex, deterministically", () => {
    const port = e2ePort(app, "wi095", {});
    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThan(21000);
    expect(e2ePort(app, "wi095", {})).toBe(port);
  });

  it("takes the variable when it is set", () => {
    expect(e2ePort(app, "000003e9", { E2E_PORT: "4321" })).toBe(4321);
    expect(e2ePort(app, undefined, { E2E_PORT: "4321" })).toBe(4321);
  });

  it.each(["abc", "80", "70000", "3100.5"])("refuses %j, naming the variable", (value) => {
    expect(() => e2ePort(app, undefined, { E2E_PORT: value })).toThrow(
      /E2E_PORT must be an integer from 1024 to 65535/,
    );
  });
});

describe("assertPortFree", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
      } else {
        server.close(() => {
          resolve();
        });
      }
    });
    server = undefined;
  });

  async function listen(): Promise<number> {
    const started = createServer();
    server = started;
    await new Promise<void>((resolve) => {
      started.listen(0, "localhost", resolve);
    });
    const address = started.address();
    if (address === null || typeof address === "string") {
      throw new Error("no port");
    }
    return address.port;
  }

  it("refuses a port that something listens on, naming the variable", async () => {
    const port = await listen();
    await expect(assertPortFree(port, "E2E_PORT")).rejects.toThrow(
      `Port ${String(port)} is already in use, probably by another end-to-end run. Set E2E_PORT to a free port.`,
    );
  });

  it("accepts a free port", async () => {
    const port = await listen();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    await expect(assertPortFree(port, "E2E_PORT")).resolves.toBeUndefined();
  });
});
