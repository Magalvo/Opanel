// Integration-test helper (WS-047): reads a Server-Sent Events response frame by frame.

/** One frame: the lines of a block that ends with a blank line. */
export interface Frame {
  event?: string;
  data?: string;
  retry?: string;
  comments: string[];
}

export interface FrameReader {
  /** The next frame, or "closed" once the stream has ended. Fails after `timeoutMs`. */
  next(timeoutMs?: number): Promise<Frame | "closed">;
  /** The next frame that carries an event, skipping comments and `retry`. */
  nextEvent(timeoutMs?: number): Promise<Frame | "closed">;
  /** Resolves once the stream has ended, reading whatever is left. */
  closed(timeoutMs?: number): Promise<void>;
  cancel(): Promise<void>;
}

function parse(block: string): Frame {
  const frame: Frame = { comments: [] };
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) frame.comments.push(line.slice(1).trim());
    else if (line.startsWith("event: ")) frame.event = line.slice(7);
    else if (line.startsWith("data: ")) frame.data = line.slice(6);
    else if (line.startsWith("retry: ")) frame.retry = line.slice(7);
  }
  return frame;
}

export function readFrames(response: Response): FrameReader {
  if (!response.body) throw new Error("The response has no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  async function next(timeoutMs = 5_000): Promise<Frame | "closed"> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return parse(block);
      }
      if (done) return "closed";
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("No frame arrived in time.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("No frame arrived in time."));
        }, remaining);
      });
      try {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (chunk.done) done = true;
        else buffer += decoder.decode(chunk.value, { stream: true });
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return {
    next,
    async nextEvent(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const frame = await next(Math.max(1, deadline - Date.now()));
        if (frame === "closed" || frame.event !== undefined) return frame;
      }
    },
    async closed(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while ((await next(Math.max(1, deadline - Date.now()))) !== "closed") {
        // Keep reading until the stream ends.
      }
    },
    async cancel() {
      if (!done) await reader.cancel().catch(() => undefined);
      done = true;
    },
  };
}
