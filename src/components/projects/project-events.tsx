"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type LiveStatus, useProjectEvents } from "@/hooks/use-project-events";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Project } from "@/lib/schemas/projects";

import { getProject } from "./api";

export interface ProjectEventListener {
  onEvent?: (event: ProjectEvent) => void;
  /** Every open of the stream after the first: events may have been missed. */
  onReconnect?: () => void;
}

interface ProjectEventsValue {
  status: LiveStatus;
  /** Whether the stream has opened at least once. */
  opened: boolean;
  subscribe: (listener: ProjectEventListener) => () => void;
}

const ProjectEventsContext = createContext<ProjectEventsValue | null>(null);

/**
 * The one events stream of a project page (WS-049 section 2), shared by every live part of
 * it: the board, the task dialog over it, the task page, the epics page, the settings. A
 * newer `project.changed` is handled here: the project is read again and set in the frame,
 * so every page follows its name and archived state.
 */
export function ProjectEventsProvider({
  project,
  setProject,
  children,
}: Readonly<{
  project: Project;
  setProject: (project: Project) => void;
  children: ReactNode;
}>) {
  const listeners = useRef(new Set<ProjectEventListener>());
  const [opened, setOpened] = useState(false);
  const latest = useRef({ project, setProject });
  useEffect(() => {
    latest.current = { project, setProject };
  });

  /** Reads the project again and sets it; the frame keeps whichever version is newest. */
  const readProject = useCallback(() => {
    getProject(latest.current.project.key).then(
      (loaded) => {
        latest.current.setProject(loaded);
      },
      () => undefined,
    );
  }, []);

  const onEvent = useCallback(
    (event: ProjectEvent) => {
      if (event.type === "project.changed" && event.version > latest.current.project.version) {
        readProject();
      }
      for (const listener of listeners.current) listener.onEvent?.(event);
    },
    [readProject],
  );

  // A reconnect may have missed a `project.changed` (doc 0002 section 4, WS-123 section 2).
  const onOpen = useCallback(
    (first: boolean) => {
      setOpened(true);
      if (first) return;
      readProject();
      for (const listener of listeners.current) listener.onReconnect?.();
    },
    [readProject],
  );

  const { status } = useProjectEvents(project.id, { onEvent, onOpen });

  const subscribe = useCallback((listener: ProjectEventListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ status, opened, subscribe }), [status, opened, subscribe]);
  return <ProjectEventsContext value={value}>{children}</ProjectEventsContext>;
}

/**
 * Listens to the page's project events (WS-049). The handlers may change on every render;
 * the latest ones are called.
 */
export function useProjectEventListener(listener: ProjectEventListener): {
  status: LiveStatus;
  opened: boolean;
} {
  const value = useContext(ProjectEventsContext);
  if (value === null) {
    throw new Error("useProjectEventListener is used outside ProjectEventsProvider.");
  }
  const handlers = useRef(listener);
  useEffect(() => {
    handlers.current = listener;
  });
  const { subscribe } = value;
  useEffect(
    () =>
      subscribe({
        onEvent: (event) => handlers.current.onEvent?.(event),
        onReconnect: () => handlers.current.onReconnect?.(),
      }),
    [subscribe],
  );
  return { status: value.status, opened: value.opened };
}
