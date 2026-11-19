import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountName } from "./account-name";

describe("AccountName (WS-074)", () => {
  it("shows a human's name and nothing else", () => {
    const { container } = render(<AccountName account={{ name: "Ada Lovelace", kind: "human" }} />);

    expect(container).toHaveTextContent(/^Ada Lovelace$/);
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });

  it("follows an agent's name with an Agent badge whose icon is hidden", () => {
    const { container } = render(<AccountName account={{ name: "QA Bot", kind: "agent" }} />);

    expect(container).toHaveTextContent(/^QA Bot\s*Agent$/);
    const badge = screen.getByText("Agent");
    expect(badge).toHaveAttribute("data-slot", "badge");
    const icon = badge.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
