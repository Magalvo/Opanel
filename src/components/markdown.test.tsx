import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders headings, emphasis, lists and code", () => {
    render(
      <Markdown>{"# Title\n\nSome **bold** and *slanted* and `code`.\n\n- one\n- two\n"}</Markdown>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("slanted").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["one", "two"]);
  });

  it("does not render raw HTML: no script, no image, no handler", () => {
    const { container } = render(
      <Markdown>
        {
          'Before <script>window.injected = true</script> <img src="https://x.test/a.png" onerror="alert(1)"> <b onclick="alert(1)">after</b>'
        }
      </Markdown>,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onclick], [onerror]")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("does not render images written in Markdown", () => {
    const { container } = render(
      <Markdown>{"![tracking pixel](https://tracker.test/p.png)"}</Markdown>,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps http, https and mailto links, which open in a new tab without an opener", () => {
    render(
      <Markdown>
        {"[web](http://a.test) [secure](https://b.test/x?y=1) [mail](mailto:ada@example.com)"}
      </Markdown>,
    );

    for (const [name, href] of [
      ["web", "http://a.test"],
      ["secure", "https://b.test/x?y=1"],
      ["mail", "mailto:ada@example.com"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("gives a link with any other scheme no href", () => {
    const { container } = render(
      <Markdown>
        {
          "[js](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [vb](vbscript:x) [ftp](ftp://a.test)"
        }
      </Markdown>,
    );

    const hrefs = Array.from(container.querySelectorAll("a")).map(
      (link) => link.getAttribute("href") ?? "",
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toBe("");
    }
  });
});
