"use client";

import { useEffect, useRef, useState } from "react";

import { PROJECT_EVENT_TYPES, type ProjectEvent, projectEventSchema } from "@/lib/schemas/events";

/** The part of the browser's `EventSource` the hook uses, so tests can pass a fake. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export type LiveStatus = "connecting" | "live" | "paused";

/** `EventSource.CLOSED`: the browser will not reconnect this source by itself. */
const CLOSED = 2;

/** Waits before a new source once the browser has given up (WS-048 section 2). */
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

function parse(event: Event, projectId: string): ProjectEvent | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(event.data);
  } catch {
    return null;
  }
  const parsed = projectEventSchema.safeParse(data);
  return parsed.success && parsed.data.projectId === projectId ? parsed.data : null;
}

/**
 * The live events of one project (WS-048 section 2, doc 0002): opens its events stream,
 * hands over every event that parses, and says when the stream opens. Every open after the
 * first is a reconnect, after which the caller reloads what it shows. When the browser
 * gives up reconnecting (a refused request), a new source is opened after a backoff.
 */
export function useProjectEvents(
  projectId: string,
  {
    onEvent,
    onOpen,
    openSource = (url) => new EventSource(url),
  }: {
    onEvent: (event: ProjectEvent) => void;
    onOpen: (first: boolean) => void;
    openSource?: (url: string) => EventSourceLike;
  },
): { status: LiveStatus } {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  // The latest handlers, so a new render does not reopen the stream.
  const handlers = useRef({ onEvent, onOpen, openSource });
  useEffect(() => {
    handlers.current = { onEvent, onOpen, openSource };
  });

  useEffect(() => {
    let first = true;
    let attempt = 0;
    let source: EventSourceLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      const current = handlers.current.openSource(`/api/v1/projects/${projectId}/events`);
      source = current;
      setStatus("connecting");
      current.addEventListener("open", () => {
        attempt = 0;
        setStatus("live");
        const wasFirst = first;
        first = false;
        handlers.current.onOpen(wasFirst);
      });
      current.addEventListener("error", () => {
        if (current.readyState !== CLOSED) {
          setStatus("connecting");
          return;
        }
        current.close();
        if (stopped) return;
        setStatus("paused");
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        timer = setTimeout(connect, wait);
      });
      for (const type of PROJECT_EVENT_TYPES) {
        current.addEventListener(type, (message) => {
          const event = parse(message, projectId);
          if (event !== null) handlers.current.onEvent(event);
        });
      }
    }

    connect();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
    };
  }, [projectId]);

  return { status };
}
