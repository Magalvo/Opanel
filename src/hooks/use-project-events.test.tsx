import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectEvent } from "@/lib/schemas/events";

import { FakeSource } from "./fake-event-source";
import { useProjectEvents } from "./use-project-events";

const PROJECT_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";
const OTHER_PROJECT = "1f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

function latest(): FakeSource {
  return FakeSource.latest();
}

function event(extra: Partial<ProjectEvent> = {}): ProjectEvent {
  return {
    id: "6f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
    type: "task.moved",
    projectId: PROJECT_ID,
    entity: "task",
    entityId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    version: 2,
    actorAccountId: "55555555-5555-4555-8555-555555555555",
    at: "2026-11-18T10:00:00.000Z",
    ...extra,
  } as ProjectEvent;
}

function render() {
  const onEvent = vi.fn<(event: ProjectEvent) => void>();
  const onOpen = vi.fn<(first: boolean) => void>();
  const hook = renderHook(() =>
    useProjectEvents(PROJECT_ID, {
      onEvent,
      onOpen,
      openSource: (url) => new FakeSource(url),
    }),
  );
  return { ...hook, onEvent, onOpen };
}

beforeEach(() => {
  FakeSource.all = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useProjectEvents (WS-048 section 2)", () => {
  it("opens the project's events stream and is live once it opens", () => {
    const { result, onOpen } = render();

    expect(latest().url).toBe(`/api/v1/projects/${PROJECT_ID}/events`);
    expect(result.current.status).toBe("connecting");

    act(() => {
      latest().open();
    });

    expect(result.current.status).toBe("live");
    expect(onOpen).toHaveBeenCalledWith(true);
  });

  it("delivers each event that parses and belongs to the project", () => {
    const { onEvent } = render();
    act(() => {
      latest().open();
      latest().send("task.moved", event());
      latest().send("column.changed", event({ type: "column.changed", entity: "column" }));
    });

    expect(onEvent.mock.calls.map(([delivered]) => delivered.type)).toEqual([
      "task.moved",
      "column.changed",
    ]);
  });

  it("drops events that do not parse or belong to another project", () => {
    const { onEvent } = render();
    act(() => {
      latest().open();
      latest().emit("task.moved", new MessageEvent("task.moved", { data: "not json" }));
      latest().send("task.moved", { ...event(), version: "two" });
      latest().send("task.moved", event({ projectId: OTHER_PROJECT }));
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("tells the caller that an open after the first is a reconnect", () => {
    const { onOpen } = render();
    act(() => {
      latest().open();
      latest().drop();
      latest().open();
    });

    expect(onOpen.mock.calls).toEqual([[true], [false]]);
  });

  it("is paused when a reconnect is refused, and opens a new source after the backoff", () => {
    vi.useFakeTimers();
    const { result, onOpen } = render();
    act(() => {
      latest().open();
      latest().refuse();
    });

    expect(result.current.status).toBe("paused");
    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]?.closed).toBe(true);

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(FakeSource.all).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeSource.all).toHaveLength(2);

    act(() => {
      latest().open();
    });
    expect(result.current.status).toBe("live");
    expect(onOpen.mock.calls).toEqual([[true], [false]]);
  });

  it("waits longer after each refusal, up to a minute", () => {
    vi.useFakeTimers();
    render();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const count = FakeSource.all.length;
      act(() => {
        latest().refuse();
      });
      let waited = 0;
      while (FakeSource.all.length === count) {
        act(() => {
          vi.advanceTimersByTime(1_000);
        });
        waited += 1_000;
      }
      waits.push(waited);
    }

    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it("closes the source when unmounted, and opens no other", () => {
    vi.useFakeTimers();
    const { unmount } = render();
    act(() => {
      latest().refuse();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]?.closed).toBe(true);
  });
});
