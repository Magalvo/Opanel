import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { json, opa, PROJECT } from "@/components/board/test-data";
import { calls, installFetch, on } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Project } from "@/lib/schemas/projects";

import { ProjectEventsProvider, useProjectEventListener } from "./project-events";

function event(type: ProjectEvent["type"], version: number): ProjectEvent {
  return {
    id: crypto.randomUUID(),
    type,
    projectId: opa.id,
    entity: type === "project.changed" ? "project" : "task",
    entityId: type === "project.changed" ? opa.id : "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    version,
    actorAccountId: "55555555-5555-4555-8555-555555555555",
    at: "2026-11-18T10:00:00.000Z",
  } as ProjectEvent;
}

function send(type: ProjectEvent["type"], version: number) {
  act(() => {
    FakeSource.latest().send(type, event(type, version));
  });
}

function wrapperFor(setProject: (project: Project) => void, project: Project = opa) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ProjectEventsProvider project={project} setProject={setProject}>
        {children}
      </ProjectEventsProvider>
    );
  };
}

beforeEach(() => {
  installFetch();
  FakeSource.all = [];
  FakeSource.autoOpen = false;
  vi.stubGlobal("EventSource", FakeSource);
});

describe("ProjectEventsProvider (WS-049 section 2)", () => {
  it("opens one stream for the project, however many parts of the page listen", () => {
    function Part() {
      useProjectEventListener({});
      return null;
    }
    render(
      <ProjectEventsProvider project={opa} setProject={vi.fn()}>
        <Part />
        <Part />
        <Part />
      </ProjectEventsProvider>,
    );

    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.latest().url).toBe(`/api/v1/projects/${opa.id}/events`);
  });

  it("gives every listener each event, and tells them about a reconnect", () => {
    const first = vi.fn<(event: ProjectEvent) => void>();
    const second = vi.fn<(event: ProjectEvent) => void>();
    const reconnected = vi.fn<() => void>();
    const wrapper = wrapperFor(vi.fn());
    renderHook(
      () => {
        useProjectEventListener({ onEvent: first, onReconnect: reconnected });
        useProjectEventListener({ onEvent: second });
      },
      { wrapper },
    );
    act(() => {
      FakeSource.latest().open();
    });

    send("task.moved", 2);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(reconnected).not.toHaveBeenCalled();

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });
    expect(reconnected).toHaveBeenCalledOnce();
  });

  it("says whether the stream has opened, and its status", () => {
    const { result } = renderHook(() => useProjectEventListener({}), {
      wrapper: wrapperFor(vi.fn()),
    });
    expect(result.current).toEqual({ opened: false, status: "connecting" });

    act(() => {
      FakeSource.latest().open();
    });

    expect(result.current).toEqual({ opened: true, status: "live" });
  });

  it("reads the project again on a newer project.changed, and sets it", async () => {
    const archived = { ...opa, archivedAt: "2026-11-18T10:00:00.000Z", version: 4 };
    on(PROJECT, json(archived));
    const setProject = vi.fn<(project: Project) => void>();
    renderHook(() => useProjectEventListener({}), { wrapper: wrapperFor(setProject) });
    act(() => {
      FakeSource.latest().open();
    });

    send("project.changed", 4);

    await waitFor(() => {
      expect(setProject).toHaveBeenCalledWith(archived);
    });
  });

  it("does nothing for a project.changed it already holds", () => {
    const setProject = vi.fn<(project: Project) => void>();
    renderHook(() => useProjectEventListener({}), { wrapper: wrapperFor(setProject) });
    act(() => {
      FakeSource.latest().open();
    });

    send("project.changed", opa.version);

    expect(calls("GET")).toEqual([]);
    expect(setProject).not.toHaveBeenCalled();
  });

  it("reads the project again on every reconnect, and sets it (WS-123 test 2)", async () => {
    const renamed = { ...opa, name: "Renamed", version: 2 };
    on(PROJECT, json(renamed));
    const setProject = vi.fn<(project: Project) => void>();
    renderHook(() => useProjectEventListener({}), { wrapper: wrapperFor(setProject) });
    act(() => {
      FakeSource.latest().open();
    });
    expect(calls("GET")).toEqual([]);

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    await waitFor(() => {
      expect(setProject).toHaveBeenCalledWith(renamed);
    });
  });
});
