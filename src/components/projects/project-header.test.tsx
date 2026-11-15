import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectHeader } from "./project-header";
import { project } from "./test-support";

describe("ProjectHeader", () => {
  it("shows the key, the name and the description as plain text", () => {
    render(
      <ProjectHeader
        project={project({ description: "<script>alert(1)</script> and **bold**" })}
        canManage={false}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Opanel" })).toBeInTheDocument();
    expect(screen.getByText("OPA")).toBeInTheDocument();
    // Stored as Markdown, shown as text until WI-038: nothing is rendered or run.
    expect(screen.getByText("<script>alert(1)</script> and **bold**")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("strong")).toBeNull();
    // The board of WI-037 replaces the placeholder line of WI-036.
    expect(screen.queryByText("The board comes next.")).not.toBeInTheDocument();
  });

  it("offers Settings only to someone who can manage", () => {
    const { rerender } = render(<ProjectHeader project={project()} canManage={false} />);
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();

    rerender(<ProjectHeader project={project()} canManage />);

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/projects/OPA/settings",
    );
  });

  it("shows an Archived badge for an archived project and none otherwise", () => {
    const { rerender } = render(<ProjectHeader project={project()} canManage={false} />);
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();

    rerender(
      <ProjectHeader
        project={project({ archivedAt: "2026-11-13T10:00:00.000Z" })}
        canManage={false}
      />,
    );

    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
});
