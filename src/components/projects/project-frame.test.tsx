import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMock, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Project } from "@/lib/schemas/projects";

let pathname = "/projects/OPA";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => pathname,
}));

const { ProjectFrame, useProject } = await import("./project-frame");

const opa: Project = {
  id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
  key: "OPA",
  name: "Opanel",
  description: "",
  archivedAt: null,
  sprintsEnabled: false,
  version: 1,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
};

beforeEach(() => {
  pathname = "/projects/OPA";
  installFetch();
});

describe("ProjectFrame", () => {
  it("shows a placeholder, then the name, key and the page", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));

    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <p>the page</p>
      </ProjectFrame>,
    );
    expect(screen.getByText("Loading the project…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 1, name: "Opanel" })).toBeVisible();
    expect(screen.getByText("OPA")).toBeVisible();
    expect(screen.getByText("the page")).toBeVisible();
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("marks an archived project", async () => {
    on("GET /api/v1/projects/OPA", () =>
      Response.json({ ...opa, archivedAt: "2026-11-14T10:00:00.000Z" }),
    );

    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>,
    );

    expect(await screen.findByText("Archived")).toBeVisible();
  });

  it("links the board for everyone and settings only for managers, marking the current page", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));

    const { unmount } = render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>,
    );
    const nav = await screen.findByRole("navigation", { name: "Project" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Board", "Backlog", "List", "Epics"]);
    expect(within(nav).getByRole("link", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    unmount();

    pathname = "/projects/OPA/settings";
    render(
      <ProjectFrame projectKey="OPA" canManageProjects>
        page
      </ProjectFrame>,
    );
    const managed = await screen.findByRole("navigation", { name: "Project" });
    expect(within(managed).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/projects/OPA/settings",
    );
    expect(within(managed).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(managed).getByRole("link", { name: "Board" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("links Epics for everyone, between Board and Settings, current on its page (WS-039)", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    pathname = "/projects/OPA/epics";
    render(
      <ProjectFrame projectKey="OPA" canManageProjects>
        page
      </ProjectFrame>,
    );

    const nav = await screen.findByRole("navigation", { name: "Project" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Board", "Backlog", "List", "Epics", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Epics" })).toHaveAttribute(
      "href",
      "/projects/OPA/epics",
    );
    expect(within(nav).getByRole("link", { name: "Epics" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Board" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the Board tab current while a task is open (WS-038)", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    pathname = "/projects/OPA/tasks/OPA-12";
    render(
      <ProjectFrame projectKey="OPA" canManageProjects>
        page
      </ProjectFrame>,
    );

    const nav = await screen.findByRole("navigation", { name: "Project" });
    expect(within(nav).getByRole("link", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("links the Backlog for everyone, after Board, current on its page (WS-109)", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    pathname = "/projects/OPA/backlog";
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>,
    );

    const nav = await screen.findByRole("navigation", { name: "Project" });
    const backlog = within(nav).getByRole("link", { name: "Backlog" });
    expect(backlog).toHaveAttribute("href", "/projects/OPA/backlog");
    expect(backlog).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Board" })).not.toHaveAttribute("aria-current");
  });

  it("links the project's List view after Backlog, never current (WS-130)", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    pathname = "/projects/OPA";
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>,
    );

    const nav = await screen.findByRole("navigation", { name: "Project" });
    const list = within(nav).getByRole("link", { name: "List" });
    expect(list).toHaveAttribute("href", "/tasks?projectId=OPA");
    expect(list).not.toHaveAttribute("aria-current");
  });

  it("keeps the tab of the list a task was opened from current (WS-109)", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    pathname = "/projects/OPA/backlog";
    const frame = (
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>
    );
    const { rerender } = render(frame);
    const nav = await screen.findByRole("navigation", { name: "Project" });

    pathname = "/projects/OPA/tasks/OPA-12";
    rerender(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>,
    );
    expect(within(nav).getByRole("link", { name: "Backlog" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Board" })).not.toHaveAttribute("aria-current");

    pathname = "/projects/OPA";
    rerender(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>,
    );
    pathname = "/projects/OPA/tasks/OPA-12";
    rerender(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        page
      </ProjectFrame>,
    );
    expect(within(nav).getByRole("link", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Backlog" })).not.toHaveAttribute("aria-current");
  });

  it("says a project the API does not know does not exist, without the page", async () => {
    on("GET /api/v1/projects/OPA", problem(404, "not_found"));

    render(
      <ProjectFrame projectKey="OPA" canManageProjects>
        <p>the page</p>
      </ProjectFrame>,
    );

    expect(await screen.findByText("This project does not exist.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All projects" })).toHaveAttribute("href", "/projects");
    expect(screen.queryByText("the page")).not.toBeInTheDocument();
  });

  it("shows any other failure with Retry", async () => {
    on("GET /api/v1/projects/OPA", problem(500, "internal_error"));
    const user = userEvent.setup();
    render(
      <ProjectFrame projectKey="OPA" canManageProjects>
        page
      </ProjectFrame>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the project.");
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Opanel" })).toBeVisible();
  });
});

describe("ProjectFrame keeps the newest project (WS-123)", () => {
  function Probe({ offers }: { offers: Project[] }) {
    const { project, setProject } = useProject();
    return (
      <>
        <p>
          {project.name}, version {String(project.version)}
          {project.archivedAt === null ? "" : ", archived"}
        </p>
        {offers.map((offer, index) => (
          <button
            key={String(index)}
            type="button"
            onClick={() => {
              setProject(offer);
            }}
          >
            {`offer ${String(index)}`}
          </button>
        ))}
      </>
    );
  }

  it("never replaces a project with an older version of it (test 1)", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    const three = { ...opa, name: "Three", version: 3 };
    const two = { ...opa, name: "Two", version: 2 };
    const threeAgain = { ...opa, name: "Three again", version: 3 };
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <Probe offers={[three, two, threeAgain]} />
      </ProjectFrame>,
    );
    expect(await screen.findByText("Opanel, version 1")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "offer 0" }));
    expect(screen.getByText("Three, version 3")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "offer 1" }));
    expect(screen.getByText("Three, version 3")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "offer 2" }));
    expect(screen.getByText("Three again, version 3")).toBeVisible();
  });

  it("reads the project again after a reconnect, and a late older read cannot undo it (test 2)", async () => {
    on("GET /api/v1/projects/OPA", () => Response.json(opa));
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <Probe offers={[]} />
      </ProjectFrame>,
    );
    expect(await screen.findByText("Opanel, version 1")).toBeVisible();
    act(() => {
      FakeSource.latest().open();
    });

    // A project.changed read that answers late, with version 2.
    let answerLate: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answerLate = resolve;
        }),
    );
    const changed = {
      id: crypto.randomUUID(),
      type: "project.changed",
      projectId: opa.id,
      entity: "project",
      entityId: opa.id,
      version: 2,
      actorAccountId: "55555555-5555-4555-8555-555555555555",
      at: "2026-11-25T10:00:00.000Z",
    } as ProjectEvent;
    act(() => {
      FakeSource.latest().send("project.changed", changed);
    });

    // The stream drops; meanwhile the project was renamed and archived (version 3), and
    // the reconnect brings no event.
    const renamed = {
      ...opa,
      name: "Renamed",
      archivedAt: "2026-11-25T10:01:00.000Z",
      version: 3,
    };
    on("GET /api/v1/projects/OPA", () => Response.json(renamed));
    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });
    expect(await screen.findByText("Renamed, version 3, archived")).toBeVisible();

    await act(async () => {
      answerLate(Response.json({ ...opa, name: "Two", version: 2 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("Renamed, version 3, archived")).toBeVisible();
  });
});
