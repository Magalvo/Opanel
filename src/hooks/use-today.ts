"use client";

import { useSyncExternalStore } from "react";

import { localDate } from "@/components/task/due-date";

// The viewer's today (WS-110 section 1), one store for the whole page: a board of many
// cards shares one timer, set for the next local midnight while anyone listens.

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

function msToNextMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  // One second past it, so the new day has begun when the timer fires.
  return midnight.getTime() - now.getTime() + 1000;
}

function schedule() {
  timer = setTimeout(() => {
    schedule();
    notify();
  }, msToNextMidnight());
}

function onVisible() {
  // A sleeping computer's timer can fire late; the date is read again on return.
  if (document.visibilityState === "visible") notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    schedule();
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** A string, so React compares snapshots by value and a same-day read changes nothing. */
function getSnapshot(): string {
  return localDate(new Date());
}

/** A server render does not know the viewer's date: it marks nothing overdue. */
function getServerSnapshot(): null {
  return null;
}

/** Today in the viewer's browser, `YYYY-MM-DD`; `null` while rendered on the server. */
export function useToday(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
