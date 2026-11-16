import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installFetch, on, problem } from "@/components/fake-api";
import type { Project } from "@/lib/schemas/projects";

let pathname = "/projects/OPA";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => pathname,
}));

const { ProjectFrame } = await import("./project-frame");

const opa: Project = {
  id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
  key: "OPA",
  name: "Opanel",
  description: "",
  archivedAt: null,
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
    ).toEqual(["Board"]);
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
