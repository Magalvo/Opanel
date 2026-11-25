"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { TaskSort } from "@/lib/schemas/tasks";

import {
  LIST_KEYS,
  readFilter,
  readSort,
  type TaskFilter,
  withValues,
  writeFilter,
  writeSort,
} from "../filters/task-filter";

function sameValues(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * The list view's filter and order (WS-130 section 2), read from the URL once and written
 * back together with `router.replace` on every change, as `useUrlTaskFilter` does. Labels
 * and epics belong to one project, so a change of projects drops them.
 */
export function useUrlTaskList(): {
  filter: TaskFilter;
  sort: TaskSort;
  ignored: string[];
  setFilter: (filter: TaskFilter) => void;
  setSort: (sort: TaskSort) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [first] = useState(() => {
    const search = new URLSearchParams(params.toString());
    const read = readFilter(search, LIST_KEYS);
    const order = readSort(search);
    return {
      filter: read.filter,
      sort: order.sort,
      ignored: [...read.ignored, ...(order.ignored ? ["sort"] : [])],
    };
  });
  const [view, setView] = useState({ filter: first.filter, sort: first.sort });

  function write(filter: TaskFilter, sort: TaskSort) {
    setView({ filter, sort });
    const query = [writeFilter(filter), writeSort(sort)].filter((part) => part !== "").join("&");
    // The page's own path with a query string: not a literal, so cast (installed Next.js docs,
    // "Route-Aware Type Helpers").
    router.replace((query === "" ? pathname : `${pathname}?${query}`) as Route, { scroll: false });
  }

  function setFilter(next: TaskFilter) {
    const kept = sameValues(next.projectId, view.filter.projectId)
      ? next
      : withValues(withValues(next, "labelId", []), "epicId", []);
    write(kept, view.sort);
  }

  function setSort(sort: TaskSort) {
    write(view.filter, sort);
  }

  return { filter: view.filter, sort: view.sort, ignored: first.ignored, setFilter, setSort };
}
