import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, hold, installFetch, on, problem } from "@/components/fake-api";
import type { Project } from "@/lib/schemas/projects";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ProjectsPage } = await import("./projects-page");

function project(key: string, name: string, archived = false): Project {
  return {
    id: crypto.randomUUID(),
    key,
    name,
    description: "",
    archivedAt: archived ? "2026-11-14T10:00:00.000Z" : null,
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

const opa = project("OPA", "Opanel");
const web = project("WEB", "Website");
const old = project("OLD", "Old site", true);

const ACTIVE = "GET /api/v1/projects?limit=50";
const ARCHIVED = "GET /api/v1/projects?limit=50&archived=true";

function page(items: Project[], nextCursor: string | null = null) {
  return () => Response.json({ items, nextCursor });
}

async function renderLoaded(canManageProjects = true) {
  on(ACTIVE, page([opa, web]));
  const user = userEvent.setup();
  render(<ProjectsPage view="active" canManageProjects={canManageProjects} />);
  await screen.findByRole("table");
  return user;
}

beforeEach(() => {
  router.push.mockReset();
  installFetch();
});

describe("ProjectsPage: the list", () => {
  it("shows a placeholder, then each project as a link with its key", async () => {
    on(ACTIVE, page([opa, web]));

    render(<ProjectsPage view="active" canManageProjects={false} />);
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Project", "Key"]);
    expect(within(table).getByRole("link", { name: "Opanel" })).toHaveAttribute(
      "href",
      "/projects/OPA",
    );
    expect(within(screen.getByRole("row", { name: /Website/ })).getByText("WEB")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
  });

  it("links the Active and Archived views, marking the current one", async () => {
    await renderLoaded(false);

    const views = screen.getByRole("navigation", { name: "Project views" });
    expect(within(views).getByRole("link", { name: "Active" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(views).getByRole("link", { name: "Archived" })).toHaveAttribute(
      "href",
      "/projects?view=archived",
    );
  });

  it("asks for archived projects in the archived view", async () => {
    on(ARCHIVED, page([old]));

    render(<ProjectsPage view="archived" canManageProjects={false} />);

    expect(await screen.findByRole("link", { name: "Old site" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Project views" })).getByRole("link", {
        name: "Archived",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("says when there are no projects, per view", async () => {
    on(ACTIVE, page([]));
    on(ARCHIVED, page([]));

    const { unmount } = render(<ProjectsPage view="active" canManageProjects={false} />);
    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
    unmount();
    render(<ProjectsPage view="archived" canManageProjects={false} />);
    expect(await screen.findByText("No archived projects.")).toBeInTheDocument();
  });

  it("shows an error with Retry, which loads again", async () => {
    on(ACTIVE, problem(500, "internal_error"));
    const user = userEvent.setup();
    render(<ProjectsPage view="active" canManageProjects={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load projects.");
    on(ACTIVE, page([opa]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("link", { name: "Opanel" })).toBeInTheDocument();
  });

  it("loads more with the cursor and hides the button on the last page", async () => {
    on(ACTIVE, page([opa], "c1"));
    on(`${ACTIVE}&cursor=c1`, page([web]));
    const user = userEvent.setup();
    render(<ProjectsPage view="active" canManageProjects={false} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "Website" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("ProjectsPage: paging (WS-080)", () => {
  it("drops a Load more answered after the view switched", async () => {
    on(ACTIVE, page([opa], "c1"));
    on(ARCHIVED, page([old]));
    const release = hold(`${ACTIVE}&cursor=c1`);
    const view = render(<ProjectsPage view="active" canManageProjects={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));

    view.rerender(<ProjectsPage view="archived" canManageProjects={false} />);
    await waitFor(() => {
      expect(calls("GET").some(([url]) => url.endsWith("archived=true"))).toBe(true);
    });
    await act(() => release(page([web])));

    expect(await screen.findByRole("link", { name: old.name })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Website" })).not.toBeInTheDocument();
  });
});

describe("ProjectsPage: a new project", () => {
  it("has no New project button for someone who cannot manage projects", async () => {
    await renderLoaded(false);

    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
  });

  it("turns the key into upper case and checks key and name in the browser", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    await user.type(within(dialog).getByLabelText("Key"), "1x");
    expect(within(dialog).getByLabelText("Key")).toHaveValue("1X");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(
      within(dialog).getByText("Use 2 to 10 letters and digits, starting with a letter."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(calls("POST")).toHaveLength(0);
  });

  it("shows a taken key at the key field", async () => {
    on("POST /api/v1/projects", problem(409, "project_key_taken"));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    await user.type(within(dialog).getByLabelText("Key"), "opa");
    await user.type(within(dialog).getByLabelText("Name"), "Again");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(await within(dialog).findByText("Another project has this key.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Key")).toHaveAttribute("aria-invalid", "true");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("creates the project and goes to it", async () => {
    on("POST /api/v1/projects", () => Response.json(project("API", "The API"), { status: 201 }));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    await user.type(within(dialog).getByLabelText("Key"), "api");
    await user.type(within(dialog).getByLabelText("Name"), "The API");
    await user.type(within(dialog).getByLabelText("Description"), "Our *public* API");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/projects/API");
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      key: "API",
      name: "The API",
      description: "Our *public* API",
    });
  });
});
