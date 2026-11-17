import { serverBusy } from "@/server/http/errors";

// Bounds how much password hashing a process does at once (WS-056). Argon2id runs on Node's
// shared libuv threadpool (4 threads by default), where file reads and DNS lookups also
// wait: an unbounded queue of hashes delays all of them. So at most MAX_RUNNING hashes run
// at once, leaving threads free, at most MAX_WAITING more wait in arrival order, and any
// request beyond that is refused at once with `429 server_busy`.

const MAX_RUNNING = 2;
const MAX_WAITING = 32;

export interface HashGate {
  /** Runs `task` when a place is free; rejects with `serverBusy()` at once if the queue is full. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createHashGate(options: { maxRunning: number; maxWaiting: number }): HashGate {
  let running = 0;
  const waiting: (() => void)[] = [];

  function release(): void {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      running -= 1;
    }
  }

  async function runNow<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } finally {
      release();
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      if (running < options.maxRunning) {
        running += 1;
        return runNow(task);
      }
      if (waiting.length >= options.maxWaiting) {
        return Promise.reject(serverBusy());
      }
      // The place of the task that releases passes straight to this one: `running` stays.
      return new Promise<void>((start) => {
        waiting.push(start);
      }).then(() => runNow(task));
    },
  };
}

/** The process-wide gate that `password.ts` uses for every hash and verification. */
export const hashGate: HashGate = createHashGate({
  maxRunning: MAX_RUNNING,
  maxWaiting: MAX_WAITING,
});
