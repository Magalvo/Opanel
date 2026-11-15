import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@/lib/schemas/projects";

import { bodyOf, calls, installFetch, on, problem, project } from "./test-support";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ProjectsPage } = await import("./projects-page");

const opanel = project();
const apollo = project({ id: "88888888-8888-4888-8888-888888888888", key: "APO", name: "Apollo" });
const old = project({
  id: "77777777-7777-4777-8777-777777777777",
  key: "OLD",
  name: "Legacy",
  archivedAt: "2026-11-13T10:00:00.000Z",
});

function list(items: Project[], nextCursor: string | null = null) {
  return () => Response.json({ items, nextCursor });
}

async function renderLoaded(canManage: boolean, items: Project[] = [opanel, apollo]) {
  on("GET /api/v1/projects?limit=50", list(items));
  const user = userEvent.setup();
  render(<ProjectsPage canManage={canManage} />);
  await screen.findByRole("table");
  return user;
}

beforeEach(() => {
  router.push.mockReset();
  installFetch();
});

describe("ProjectsPage: the list", () => {
  it("shows a placeholder while loading, then key, name link and status of each project", async () => {
    on("GET /api/v1/projects?limit=50", list([opanel, apollo]));

    render(<ProjectsPage canManage={false} />);
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Key", "Name", "Status"]);
    const rowOpanel = screen.getByRole("row", { name: /OPA/ });
    expect(within(rowOpanel).getByRole("link", { name: "Opanel" })).toHaveAttribute(
      "href",
      "/projects/OPA",
    );
    expect(within(rowOpanel).getByText("Active")).toBeInTheDocument();
  });

  it("says it could not load and retries", async () => {
    on("GET /api/v1/projects?limit=50", () => problem(500, { code: "internal_error" }));
    const user = userEvent.setup();
    render(<ProjectsPage canManage={false} />);

    expect(await screen.findByText("Could not load projects.")).toBeInTheDocument();
    on("GET /api/v1/projects?limit=50", list([opanel]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("loads more with the cursor and stops offering it on the last page", async () => {
    on("GET /api/v1/projects?limit=50", list([opanel], "CURSOR1"));
    on("GET /api/v1/projects?limit=50&cursor=CURSOR1", list([apollo]));
    const user = userEvent.setup();
    render(<ProjectsPage canManage={false} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "Apollo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Opanel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says so when there are no projects", async () => {
    on("GET /api/v1/projects?limit=50", list([]));
    render(<ProjectsPage canManage={false} />);

    expect(await screen.findByText("There are no projects yet.")).toBeInTheDocument();
  });

  it("offers New project only to someone who can manage", async () => {
    await renderLoaded(false);
    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
  });
});

describe("ProjectsPage: archived projects", () => {
  it("re-loads from the first page with archived=true, and back", async () => {
    const user = await renderLoaded(false);
    on("GET /api/v1/projects?limit=50&archived=true", list([old]));

    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));

    expect(await screen.findByRole("link", { name: "Legacy" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Opanel" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /OLD/ })).getByText("Archived"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));

    expect(await screen.findByRole("link", { name: "Opanel" })).toBeInTheDocument();
  });

  it("says when there are no archived projects", async () => {
    const user = await renderLoaded(false);
    on("GET /api/v1/projects?limit=50&archived=true", list([]));

    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));

    expect(await screen.findByText("There are no archived projects.")).toBeInTheDocument();
  });
});

describe("ProjectsPage: creating", () => {
  async function openCreate() {
    const user = await renderLoaded(true, [opanel]);
    await user.click(screen.getByRole("button", { name: "New project" }));
    return { user, dialog: await screen.findByRole("dialog", { name: "New project" }) };
  }

  it("upper-cases the key, says it is permanent, validates, posts and opens the new project", async () => {
    const { user, dialog } = await openCreate();
    expect(
      within(dialog).getByText("2 to 10 uppercase letters and digits. It cannot be changed later."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(calls("POST")).toHaveLength(0);
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();

    on("POST /api/v1/projects", () => Response.json(apollo, { status: 201 }));
    await user.type(within(dialog).getByLabelText("Key"), "apo");
    expect(within(dialog).getByLabelText("Key")).toHaveValue("APO");
    await user.type(within(dialog).getByLabelText("Name"), "Apollo");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/projects/APO");
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ key: "APO", name: "Apollo" });
  });

  it("sends a description when there is one", async () => {
    const { user, dialog } = await openCreate();
    on("POST /api/v1/projects", () => Response.json(apollo, { status: 201 }));

    await user.type(within(dialog).getByLabelText("Key"), "APO");
    await user.type(within(dialog).getByLabelText("Name"), "Apollo");
    await user.type(within(dialog).getByLabelText("Description"), "Moon shot");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(calls("POST")).toHaveLength(1);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      key: "APO",
      name: "Apollo",
      description: "Moon shot",
    });
  });

  it("refuses a key that is too short in the browser", async () => {
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Key"), "A");
    await user.type(within(dialog).getByLabelText("Name"), "Apollo");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(calls("POST")).toHaveLength(0);
    expect(
      within(dialog).getByText("Enter a key of 2 to 10 uppercase letters and digits."),
    ).toBeInTheDocument();
  });

  it("shows a taken key next to the field and stays", async () => {
    const { user, dialog } = await openCreate();
    on("POST /api/v1/projects", () => problem(409, { code: "project_key_taken" }));

    await user.type(within(dialog).getByLabelText("Key"), "OPA");
    await user.type(within(dialog).getByLabelText("Name"), "Again");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(await within(dialog).findByText("This key is already used.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("ProjectsPage: accessibility", () => {
  it("has a heading, an announced status region and named controls", async () => {
    await renderLoaded(true);

    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Show archived" })).toBeInTheDocument();
  });

  it("closes the create dialog with Escape and returns focus to its button", async () => {
    const user = await renderLoaded(true);
    const opener = screen.getByRole("button", { name: "New project" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "New project" });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });
});
