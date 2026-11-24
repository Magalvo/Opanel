"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { type FilterKey, readFilter, type TaskFilter, writeFilter } from "./task-filter";

/**
 * A page's filter, read from its URL once, and written back with `router.replace` on every
 * change, so a link opens the same view and the history does not fill with every keystroke
 * (WS-120 section 2).
 */
export function useUrlTaskFilter(keys: readonly FilterKey[]): {
  filter: TaskFilter;
  ignored: FilterKey[];
  setFilter: (filter: TaskFilter) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [first] = useState(() => readFilter(new URLSearchParams(params.toString()), keys));
  const [filter, setState] = useState<TaskFilter>(first.filter);

  function setFilter(next: TaskFilter) {
    setState(next);
    const query = writeFilter(next);
    // The page's own path with a query string: not a literal, so cast (installed Next.js docs,
    // "Route-Aware Type Helpers").
    router.replace((query === "" ? pathname : `${pathname}?${query}`) as Route, { scroll: false });
  }

  return { filter, ignored: first.ignored, setFilter };
}
