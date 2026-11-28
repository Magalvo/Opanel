import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { json, opa, page, PROJECT, task } from "@/components/board/test-data";
import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Project } from "@/lib/schemas/projects";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA/settings",
}));

const { ProjectFrame } = await import("./project-frame");
const { SprintsSection } = await import("./sprints-section");

// Test 1 of WS-144: the settings' "Sprints" section (section 3).

const PATCH = "PATCH /api/v1/projects/OPA";
const BOARD_FIRST = "GET /api/v1/projects/OPA/tasks?limit=1";

function Harness({ readOnly }: Readonly<{ readOnly: boolean }>) {
  const [message, setMessage] = useState("");
  return (
    <>
      <p role="status">{message}</p>
      <SprintsSection announce={setMessage} readOnly={readOnly} />
    </>
  );
}

async function renderSection({
  project = opa,
  readOnly = false,
}: { project?: Project; readOnly?: boolean } = {}) {
  on(PROJECT, json(project));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects>
      <Harness readOnly={readOnly} />
    </ProjectFrame>,
  );
  await screen.findByRole("region", { name: "Sprints" });
  return user;
}

function toggle() {
  return within(screen.getByRole("region", { name: "Sprints" })).getByRole("switch", {
    name: "Use sprints",
  });
}

beforeEach(() => {
  installFetch();
  FakeSource.all = [];
  FakeSource.autoOpen = true;
  vi.stubGlobal("EventSource", FakeSource);
  on(BOARD_FIRST, page([task(1, "11111111-1111-4111-8111-111111111111")], "next"));
});

describe("SprintsSection (WS-144 section 3, test 1)", () => {
  it("shows a named switch, off in a project without sprints, and says what sprints do", async () => {
    await renderSection();

    expect(toggle()).not.toBeChecked();
    expect(screen.getByRole("region", { name: "Sprints" })).toHaveTextContent(
      /the board shows the active sprint/,
    );
  });

  it("says the board's tasks become Sprint 1 before turning sprints on, and sends the change", async () => {
    on(PATCH, json({ ...opa, sprintsEnabled: true, version: 4 }));
    const user = await renderSection();

    await user.click(toggle());
    const dialog = await screen.findByRole("alertdialog", { name: "Use sprints?" });
    await waitFor(() => {
      expect(dialog).toHaveTextContent(
        "Tasks on the board become 'Sprint 1', active from today for 14 days. You can rename it and change its dates in the backlog.",
      );
    });
    await user.click(within(dialog).getByRole("button", { name: "Use sprints" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ sprintsEnabled: true, version: 3 });
    await waitFor(() => {
      expect(toggle()).toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sprints are on.");
    expect(toggle()).toHaveFocus();
  });

  it("says no sprint is created when the board is empty", async () => {
    on(BOARD_FIRST, page([]));
    const user = await renderSection();

    await user.click(toggle());

    const dialog = await screen.findByRole("alertdialog", { name: "Use sprints?" });
    await waitFor(() => {
      expect(dialog).toHaveTextContent("No sprint is created.");
    });
    expect(dialog).not.toHaveTextContent("Sprint 1");
  });

  it("says what happens to completed sprints before turning sprints off", async () => {
    on(PATCH, json({ ...opa, sprintsEnabled: false, version: 5 }));
    const user = await renderSection({ project: { ...opa, sprintsEnabled: true, version: 4 } });

    expect(toggle()).toBeChecked();
    await user.click(toggle());
    const dialog = await screen.findByRole("alertdialog", { name: "Stop using sprints?" });
    expect(dialog).toHaveTextContent(
      "Done tasks of completed sprints come back to the board, and planned sprints are kept for later.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Stop using sprints" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ sprintsEnabled: false, version: 4 });
    await waitFor(() => {
      expect(toggle()).not.toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sprints are off.");
  });

  it("explains sprint_active with a link to the board, and stays on", async () => {
    on(PATCH, problem(409, "sprint_active"));
    const user = await renderSection({ project: { ...opa, sprintsEnabled: true, version: 4 } });

    await user.click(toggle());
    const dialog = await screen.findByRole("alertdialog", { name: "Stop using sprints?" });
    await user.click(within(dialog).getByRole("button", { name: "Stop using sprints" }));

    const region = screen.getByRole("region", { name: "Sprints" });
    await waitFor(() => {
      expect(region).toHaveTextContent("Complete the active sprint first.");
    });
    expect(within(region).getByRole("link", { name: "Open the board" })).toHaveAttribute(
      "href",
      "/projects/OPA",
    );
    expect(toggle()).toBeChecked();
  });

  it("shows the current project on a version conflict and says why", async () => {
    const current = { ...opa, sprintsEnabled: true, version: 6 };
    on(PATCH, () =>
      Response.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "version_conflict",
          detail: "A problem.",
          requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
          current,
        },
        { status: 409, headers: { "Content-Type": "application/problem+json" } },
      ),
    );
    const user = await renderSection();

    await user.click(toggle());
    const dialog = await screen.findByRole("alertdialog", { name: "Use sprints?" });
    await user.click(within(dialog).getByRole("button", { name: "Use sprints" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Someone else changed this project. Their version is shown; make your change again.",
      );
    });
    expect(toggle()).toBeChecked();
  });

  it("changes nothing when the dialog is cancelled", async () => {
    const user = await renderSection();

    await user.click(toggle());
    const dialog = await screen.findByRole("alertdialog", { name: "Use sprints?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(calls("PATCH")).toHaveLength(0);
    expect(toggle()).not.toBeChecked();
    await waitFor(() => {
      expect(toggle()).toHaveFocus();
    });
  });

  it("is read-only without sprints:manage, still showing the setting", async () => {
    await renderSection({ project: { ...opa, sprintsEnabled: true }, readOnly: true });

    expect(toggle()).toBeChecked();
    expect(toggle()).toBeDisabled();
  });

  it("follows someone else's change of the setting", async () => {
    await renderSection();
    on(PROJECT, json({ ...opa, sprintsEnabled: true, version: 4 }));

    act(() => {
      FakeSource.latest().send("project.changed", {
        id: crypto.randomUUID(),
        type: "project.changed",
        projectId: opa.id,
        entity: "project",
        entityId: opa.id,
        version: 4,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-12-05T10:00:00.000Z",
      });
    });

    await waitFor(() => {
      expect(toggle()).toBeChecked();
    });
  });
});
