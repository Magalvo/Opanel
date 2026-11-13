import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AcceptPage, { metadata } from "./page";

describe("the /accept page", () => {
  it("renders without a database and asks browsers not to send a referrer", async () => {
    render(<AcceptPage />);

    expect(await screen.findByText("This link is not valid.")).toBeInTheDocument();
    expect(metadata.referrer).toBe("no-referrer");
  });
});
