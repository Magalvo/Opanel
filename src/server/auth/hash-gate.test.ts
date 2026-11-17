import { describe, expect, it } from "vitest";

import { ApiError } from "@/server/http/errors";

import { createHashGate } from "./hash-gate";

/** A task whose promise the test settles by hand, recording when it started. */
function controlled(started: string[], name: string) {
  let resolve: (value: string) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const task = () => {
    started.push(name);
    return new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return {
    task,
    resolve: (value = name) => {
      resolve(value);
    },
    reject: (reason: Error) => {
      reject(reason);
    },
  };
}

/** Lets every settled promise run its continuations. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("createHashGate (WS-056)", () => {
  it("never runs more than maxRunning tasks at once, and starts waiting ones in arrival order", async () => {
    const gate = createHashGate({ maxRunning: 2, maxWaiting: 10 });
    const started: string[] = [];
    const tasks = ["a", "b", "c", "d"].map((name) => controlled(started, name));
    const results = tasks.map((t) => gate.run(t.task));

    await flush();
    expect(started).toEqual(["a", "b"]);

    tasks[1]?.resolve();
    await flush();
    expect(started).toEqual(["a", "b", "c"]);

    tasks[0]?.resolve();
    await flush();
    expect(started).toEqual(["a", "b", "c", "d"]);

    tasks[2]?.resolve();
    tasks[3]?.resolve();
    expect(await Promise.all(results)).toEqual(["a", "b", "c", "d"]);
  });

  it("refuses with 429 server_busy, without calling the task, once maxWaiting tasks wait", async () => {
    const gate = createHashGate({ maxRunning: 1, maxWaiting: 2 });
    const started: string[] = [];
    const tasks = ["run", "wait1", "wait2"].map((name) => controlled(started, name));
    const results = tasks.map((t) => gate.run(t.task));
    let refusedCalled = false;

    const refused = gate.run(() => {
      refusedCalled = true;
      return Promise.resolve("never");
    });

    const error = await refused.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "server_busy", retryAfterSeconds: 1 });
    expect(refusedCalled).toBe(false);

    // Once one settles there is room again.
    tasks[0]?.resolve();
    await flush();
    const later = controlled(started, "later");
    const accepted = gate.run(later.task);
    tasks[1]?.resolve();
    await flush();
    tasks[2]?.resolve();
    await flush();
    expect(started).toEqual(["run", "wait1", "wait2", "later"]);
    later.resolve();
    expect(await accepted).toBe("later");
    await Promise.all(results);
  });

  it("frees the place of a task that rejects and of one that throws synchronously", async () => {
    const gate = createHashGate({ maxRunning: 1, maxWaiting: 5 });
    const started: string[] = [];
    const failing = controlled(started, "failing");
    const first = gate.run(failing.task);
    const thrower = gate.run(() => {
      started.push("thrower");
      throw new Error("sync failure");
    });
    const last = controlled(started, "last");
    const third = gate.run(last.task);

    failing.reject(new Error("async failure"));
    await expect(first).rejects.toThrow("async failure");
    await expect(thrower).rejects.toThrow("sync failure");
    await flush();
    expect(started).toEqual(["failing", "thrower", "last"]);

    last.resolve();
    expect(await third).toBe("last");
  });
});
