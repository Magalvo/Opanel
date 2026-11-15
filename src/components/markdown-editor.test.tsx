import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { MarkdownEditor } from "./markdown-editor";

function Harness({ initial = "" }: Readonly<{ initial?: string }>) {
  const [value, setValue] = useState(initial);
  return <MarkdownEditor noun="notes" label="Notes" value={value} onChange={setValue} />;
}

describe("MarkdownEditor", () => {
  it("writes in a named text box and previews the same text as Markdown", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("textbox", { name: "Notes" }), "Hello **world**");
    await user.click(screen.getByRole("tab", { name: "Preview notes" }));

    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(screen.queryByRole("textbox", { name: "Notes" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Write notes" }));
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Hello **world**");
  });

  it("says there is nothing to preview for an empty text, and never runs a script", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<Harness />);

    await user.click(screen.getByRole("tab", { name: "Preview notes" }));
    expect(screen.getByText("Nothing to preview.")).toBeInTheDocument();

    rerender(<Harness initial="<script>window.injected = true</script>" />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("marks the selected tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("tab", { name: "Write notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "Preview notes" }));
    expect(screen.getByRole("tab", { name: "Preview notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
