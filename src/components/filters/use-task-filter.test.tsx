import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, opa, page, PROJECT, task, todo } from "@/components/board/test-data";
import { calls, hold, installFetch, on } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";

import type { TaskFilter } from "./task-filter";

// The matching tasks of a filtered page (WS-120 section 4, test 5).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA",
}));

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { useTaskFilter } = await import("./use-task-filter");

const BUGS = "GET /api/v1/projects/OPA/tasks?limit=100&type=bug";
const STORIES = "GET /api/v1/projects/OPA/tasks?limit=100&type=story";
const t1 = task(1, todo.id, { type: "bug" });
const t2 = task(2, todo.id, { type: "story" });

function Probe({ filter }: Readonly<{ filter: TaskFilter }>) {
  const matching = useTaskFilter({ projectKey: "OPA", place: "board", filter });
  return (
    <p data-testid="matching">
      {matching === "all" ? "all" : matching === "loading" ? "loading" : [...matching].join(",")}
    </p>
  );
}

function renderProbe(filter: TaskFilter) {
  on(PROJECT, json(opa));
  const view = render(
    <ProjectFrame projectKey="OPA" canManageProjects={false}>
      <Probe filter={filter} />
    </ProjectFrame>,
  );
  return {
    rerender: (next: TaskFilter) => {
      view.rerender(
        <ProjectFrame projectKey="OPA" canManageProjects={false}>
          <Probe filter={next} />
        </ProjectFrame>,
      );
    },
  };
}

function reads(key: string): number {
  return calls("GET").filter(([url]) => `GET ${url}` === key).length;
}

function send(type: string) {
  act(() => {
    FakeSource.latest().send(type, {
      id: crypto.randomUUID(),
      type,
      projectId: opa.id,
      entity: type.split(".")[0],
      entityId: t1.id,
      version: 2,
      actorAccountId: "55555555-5555-4555-8555-555555555555",
      at: "2026-11-24T10:00:00.000Z",
    });
  });
}

beforeEach(() => {
  installFetch();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeSource.all = [];
  FakeSource.autoOpen = true;
  vi.stubGlobal("EventSource", FakeSource);
  on(BUGS, page([t1]));
  on(STORIES, page([t2]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTaskFilter (WS-120 test 5)", () => {
  it("is all with no filter, and reads nothing", async () => {
    renderProbe({});

    expect(await screen.findByTestId("matching")).toHaveTextContent("all");
    expect(calls("GET").filter(([url]) => url.includes("/tasks"))).toHaveLength(0);
  });

  it("reads the filtered list once, and again at most once a second over a burst", async () => {
    renderProbe({ type: ["bug"] });
    expect(await screen.findByText(t1.id)).toBeInTheDocument();
    expect(reads(BUGS)).toBe(1);

    for (let index = 0; index < 5; index += 1) send("task.updated");
    expect(reads(BUGS)).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(reads(BUGS)).toBe(2);
  });

  it("reads again for a label change, and ignores other events", async () => {
    renderProbe({ type: ["bug"] });
    await screen.findByText(t1.id);

    send("column.changed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(reads(BUGS)).toBe(1);

    send("label.changed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(reads(BUGS)).toBe(2);
  });

  it("applies only the latest answer when the filter changes during a read", async () => {
    const release = hold(BUGS);
    const probe = renderProbe({ type: ["bug"] });
    expect(await screen.findByTestId("matching")).toHaveTextContent("loading");

    probe.rerender({ type: ["story"] });
    expect(await screen.findByText(t2.id)).toBeInTheDocument();
    await act(() => release(page([t1])));

    expect(screen.getByTestId("matching")).toHaveTextContent(t2.id);
  });
});
