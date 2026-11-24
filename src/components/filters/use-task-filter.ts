"use client";

import { useEffect, useRef, useState } from "react";

import { useProjectEventListener } from "@/components/projects/project-events";
import { call } from "@/lib/api-client";
import { MAX_PAGE_LIMIT } from "@/lib/schemas/pagination";
import { taskPageSchema } from "@/lib/schemas/tasks";

import { filterQuery, isEmpty, type TaskFilter, writeFilter } from "./task-filter";

/** At most one read of the matching tasks a second, after events (WT-08 question 4). */
export const REFRESH_MS = 1_000;

/** The ids of every task the filtered list returns, every page. */
async function matchingIds(
  projectKey: string,
  place: "board" | "backlog",
  filter: TaskFilter,
): Promise<Set<string>> {
  const path = place === "board" ? "tasks" : "backlog";
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const after: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const page = await call(
      `/api/v1/projects/${projectKey}/${path}?limit=${String(MAX_PAGE_LIMIT)}${filterQuery(filter)}${after}`,
      {},
      taskPageSchema,
    );
    for (const task of page.items) ids.add(task.id);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return ids;
}

export type Matching = "all" | "loading" | ReadonlySet<string>;

/**
 * Which tasks of a board or a backlog the filter keeps (WS-120 section 4): "all" with no
 * filter; otherwise the ids the filtered list returns, read again after a task or label
 * event at most once a second, and after a reconnect. Only the latest answer is applied.
 */
export function useTaskFilter({
  projectKey,
  place,
  filter,
}: {
  projectKey: string;
  place: "board" | "backlog";
  filter: TaskFilter;
}): Matching {
  const query = writeFilter(filter);
  const empty = isEmpty(filter);
  const [answer, setAnswer] = useState<{ query: string; ids: ReadonlySet<string> } | null>(null);
  const state = useRef({
    generation: 0,
    lastRead: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
  });
  const latest = useRef({ projectKey, place, filter, empty });
  // Declared before the read below, so it runs first after a render.
  useEffect(() => {
    latest.current = { projectKey, place, filter, empty };
  });

  const read = useRef(() => {
    const { projectKey: key, place: where, filter: current, empty: none } = latest.current;
    const generation = ++state.current.generation;
    if (none) return;
    state.current.lastRead = Date.now();
    const asked = writeFilter(current);
    matchingIds(key, where, current).then(
      (ids) => {
        if (generation === state.current.generation) setAnswer({ query: asked, ids });
      },
      () => undefined,
    );
  });

  // A new filter is read at once.
  useEffect(() => {
    if (state.current.timer !== null) clearTimeout(state.current.timer);
    state.current.timer = null;
    read.current();
  }, [query, projectKey, place]);

  useEffect(
    () => () => {
      if (state.current.timer !== null) clearTimeout(state.current.timer);
    },
    [],
  );

  function soon() {
    if (latest.current.empty || state.current.timer !== null) return;
    const wait = Math.max(0, state.current.lastRead + REFRESH_MS - Date.now());
    state.current.timer = setTimeout(() => {
      state.current.timer = null;
      read.current();
    }, wait);
  }

  useProjectEventListener({
    onEvent: (event) => {
      if (event.type.startsWith("task.") || event.type === "label.changed") soon();
    },
    onReconnect: () => {
      soon();
    },
  });

  if (empty) return "all";
  // While a new filter is read, the last answer stays, so the page does not flash.
  if (answer === null) return "loading";
  return answer.ids;
}
