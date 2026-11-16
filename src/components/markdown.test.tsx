import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

function renderMarkdown(source: string) {
  return render(<Markdown>{source}</Markdown>).container;
}

describe("Markdown: what it renders (WS-038 section 3)", () => {
  it("renders headings, emphasis, lists, code, quotes and links", () => {
    const container = renderMarkdown(
      [
        "# Title",
        "",
        "Some *emphasis*, **strong** and `code`.",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
        "",
        "```",
        "block",
        "```",
        "",
        "[a link](https://example.com)",
      ].join("\n"),
    );

    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(container.querySelector("em")).toHaveTextContent("emphasis");
    expect(container.querySelector("strong")).toHaveTextContent("strong");
    expect(container.querySelector("code")).toHaveTextContent("code");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("blockquote")).toHaveTextContent("quoted");
    expect(container.querySelector("pre")).toHaveTextContent("block");
    expect(screen.getByRole("link", { name: "a link" })).toBeInTheDocument();
  });

  it("renders no element from raw HTML", () => {
    const container = renderMarkdown(
      [
        "<script>window.injected = true</script>",
        "",
        '<img src="x" onerror="window.injected = true">',
        "",
        "<b>bold?</b> and <iframe src='https://example.com'></iframe>",
        "",
        "text",
      ].join("\n"),
    );

    for (const tag of ["script", "img", "b", "iframe"]) {
      expect(container.querySelector(tag), tag).toBeNull();
    }
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container).toHaveTextContent("text");
  });
});

describe("Markdown: links and images", () => {
  it.each(["https://example.com/a", "http://example.com/b", "mailto:ada@example.com"])(
    "keeps %s, in a new tab with noopener noreferrer",
    (url) => {
      renderMarkdown(`[go](${url})`);
      const link = screen.getByRole("link", { name: "go" });

      expect(link).toHaveAttribute("href", url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    },
  );

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "/relative/path",
  ])("drops the href of %s", (url) => {
    const container = renderMarkdown(`[go](${url})`);

    expect(container.querySelector("a[href]")).toBeNull();
    expect(container).toHaveTextContent("go");
  });

  it("drops the href of an autolink with another scheme too", () => {
    const container = renderMarkdown("<javascript:alert(1)>");

    expect(container.querySelector("a[href]")).toBeNull();
  });

  it("shows an image as its alt text, never as an image", () => {
    const container = renderMarkdown("![a diagram](https://example.com/pixel.png)");

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("a diagram");
  });
});
