import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { default: AcceptPage, metadata } = await import("./page");

describe("the /accept page", () => {
  it("renders without a database and asks browsers not to send a referrer", async () => {
    render(<AcceptPage />);

    expect(await screen.findByText("This link is not valid.")).toBeInTheDocument();
    expect(metadata.referrer).toBe("no-referrer");
  });
});
