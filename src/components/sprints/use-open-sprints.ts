"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useProjectEventListener } from "@/components/projects/project-events";
import type { Sprint } from "@/lib/schemas/sprints";

import { listOpenSprints } from "./api";
import { activeSprintOf, plannedSprintsOf } from "./sections";

export type SprintsPhase = "loading" | "error" | "ready";

/**
 * The active and planned sprints of a project with sprints (WS-144 section 9), for the board
 * and the backlog. Read when sprints are on, again on `sprint.changed` and after a
 * reconnect; only the latest answer is applied. `onActiveChanged` is called when a read
 * finds another active sprint, or none, than the one before: a start or a completion,
 * which changes which tasks the page lists.
 */
export function useOpenSprints({
  projectKey,
  enabled,
  onActiveChanged,
}: {
  projectKey: string;
  enabled: boolean;
  onActiveChanged: () => void;
}) {
  const [phase, setPhase] = useState<SprintsPhase>("loading");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const generation = useRef(0);
  // The active sprint's id after the last read; `undefined` before the first one.
  const activeId = useRef<string | null | undefined>(undefined);
  const changed = useRef(onActiveChanged);
  useEffect(() => {
    changed.current = onActiveChanged;
  });

  const reload = useCallback(async (): Promise<void> => {
    const mine = ++generation.current;
    let loaded: Sprint[];
    try {
      loaded = await listOpenSprints(projectKey);
    } catch {
      if (mine === generation.current) setPhase("error");
      return;
    }
    if (mine !== generation.current) return;
    setSprints(loaded);
    setPhase("ready");
    const active = activeSprintOf(loaded)?.id ?? null;
    const before = activeId.current;
    activeId.current = active;
    if (before !== undefined && before !== active) changed.current();
  }, [projectKey]);

  /**
   * Shows a sprint this page created or changed at once, in place of a read; a read already
   * running is dropped, and the sprint's own event reads them all again.
   */
  const put = useCallback((sprint: Sprint) => {
    generation.current++;
    setSprints((current) =>
      sprint.state === "completed"
        ? current.filter((item) => item.id !== sprint.id)
        : current.some((item) => item.id === sprint.id)
          ? current.map((item) => (item.id === sprint.id ? sprint : item))
          : [...current, sprint],
    );
  }, []);

  /** Takes out a sprint this page deleted. */
  const remove = useCallback((sprintId: string) => {
    generation.current++;
    setSprints((current) => current.filter((item) => item.id !== sprintId));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Started from a timer, as the board's first load is, so the effect sets no state itself.
    const timer = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [enabled, reload]);

  useProjectEventListener({
    onEvent: (event) => {
      if (enabled && event.type === "sprint.changed") void reload();
    },
    onReconnect: () => {
      if (enabled) void reload();
    },
  });

  return {
    phase,
    sprints,
    active: activeSprintOf(sprints),
    planned: plannedSprintsOf(sprints),
    reload,
    put,
    remove,
  };
}
