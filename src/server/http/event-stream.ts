import type { ProjectEvent } from "@/lib/schemas/events";
import { type Actor, can, canAccessProject } from "@/server/auth/actor";
import { authenticate as authenticateRequest } from "@/server/auth/authenticate";
import { type EventHub, getEventHub } from "@/server/services/event-hub";

import { tooManyStreams } from "./errors";
import { describeError } from "./safe-error";

export interface EventStreamOptions {
  request: Request;
  projectId: string;
  /** The account the stream counts against (decision 7). */
  account: string;
  hub?: EventHub;
  /** The heartbeat's credential check; by default one that extends no session (WS-124). */
  authenticate?: (request: Request) => Promise<{ actor: Actor }>;
  heartbeatMs?: number;
  maxStreamsPerAccount?: number;
  logError?: (message: string) => void;
}

const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_ACCOUNT = 10;
/** Bytes a reader may leave unread before its stream is dropped (decision 8). */
const HIGH_WATER_MARK = 64 * 1024;

/** Open streams per account in this process (WT-04 decision 7). */
const openStreams = new Map<string, number>();

const encoder = new TextEncoder();
const HEARTBEAT = encoder.encode(": heartbeat\n\n");

function frameOf(event: ProjectEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** Watching a board is not using the app: a heartbeat extends no session (WS-124). */
function checkWithoutRenewal(request: Request): Promise<{ actor: Actor }> {
  return authenticateRequest(request, { refreshSession: false });
}

/**
 * The events of one project as Server-Sent Events (WS-047). Takes a place in the account's
 * cap, subscribes to the hub, and only then answers, so every event committed after the
 * client has the response reaches it. The stream ends, and gives its place back exactly
 * once, when the client goes away, the reader falls 64 KiB behind, the hub resets, or a
 * heartbeat finds the credentials no longer valid, without `tasks:read`, or without the
 * project (WS-073). Heartbeats count against the 64 KiB as events do, and one heartbeat
 * check runs at a time (WS-124).
 */
export async function openEventStream({
  request,
  projectId,
  account,
  hub = getEventHub(),
  authenticate = checkWithoutRenewal,
  heartbeatMs = HEARTBEAT_MS,
  maxStreamsPerAccount = MAX_STREAMS_PER_ACCOUNT,
  logError = console.error,
}: EventStreamOptions): Promise<Response> {
  // Taken before any await, so concurrent requests cannot both slip under the cap.
  const held = openStreams.get(account) ?? 0;
  if (held >= maxStreamsPerAccount) throw tooManyStreams();
  openStreams.set(account, held + 1);

  let finished = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let unsubscribe: (() => void) | undefined;
  const timer: { heartbeat?: ReturnType<typeof setTimeout> } = {};

  function finish(): void {
    if (finished) return;
    finished = true;
    unsubscribe?.();
    clearTimeout(timer.heartbeat);
    request.signal.removeEventListener("abort", finish);
    try {
      controller?.close();
    } catch {
      // Already closed or cancelled by the reader.
    }
    const count = (openStreams.get(account) ?? 1) - 1;
    if (count > 0) openStreams.set(account, count);
    else openStreams.delete(account);
  }

  /**
   * Queues a chunk, or ends the stream when the chunk would take what the reader has left
   * unread past 64 KiB: drop a reader that has fallen too far behind rather than queue more.
   * Answers whether the chunk was queued.
   */
  function write(chunk: Uint8Array): boolean {
    if (finished || !controller) return false;
    if ((controller.desiredSize ?? 0) < chunk.byteLength) {
      finish();
      return false;
    }
    controller.enqueue(chunk);
    return true;
  }

  try {
    unsubscribe = await hub.subscribe(projectId, {
      event(event) {
        write(frameOf(event));
      },
      reset: finish,
    });
  } catch (error) {
    finish();
    throw error;
  }

  const stream = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController;
        streamController.enqueue(encoder.encode("retry: 3000\n: connected\n\n"));
      },
      cancel() {
        finish();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: HIGH_WATER_MARK }),
  );

  // Each heartbeat schedules the next once its check has settled: never two checks at once.
  function scheduleHeartbeat(): void {
    if (!finished) timer.heartbeat = setTimeout(heartbeat, heartbeatMs);
  }

  function heartbeat(): void {
    if (finished) return;
    authenticate(request).then(
      ({ actor }) => {
        if (finished) return;
        if (!can(actor, "tasks:read") || !canAccessProject(actor, projectId)) finish();
        else if (write(HEARTBEAT)) scheduleHeartbeat();
      },
      (error: unknown) => {
        if (finished) return;
        // An expired or revoked session is ordinary; anything else is worth a line.
        if (!(error instanceof Error && "status" in error && error.status === 401)) {
          logError(`An event stream's credential check failed: ${describeError(error)}`);
        }
        finish();
      },
    );
  }

  scheduleHeartbeat();

  if (request.signal.aborted) finish();
  else request.signal.addEventListener("abort", finish);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
