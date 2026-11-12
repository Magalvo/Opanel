import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }) }));

const { AccountMenu } = await import("./account-menu");

const account = {
  id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
  kind: "human" as const,
  name: "Ada Admin",
  email: "ada@example.com",
  role: "admin",
};

const fetchMock = vi.fn<typeof fetch>();

describe("AccountMenu", () => {
  beforeEach(() => {
    replace.mockReset();
    refresh.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation((input, init) =>
      Promise.resolve(
        init?.method === "POST"
          ? new Response(null, { status: 204 })
          : Response.json({ ...account, permissions: [] }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows the person's initial on its trigger", () => {
    render(<AccountMenu account={account} />);

    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("A");
  });

  it("opens to the name, email and role", async () => {
    const user = userEvent.setup();
    render(<AccountMenu account={account} />);

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("signs out through the API, then replaces the route with /sign-in and refreshes", async () => {
    const user = userEvent.setup();
    render(<AccountMenu account={account} />);

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/sign-in");
    });
    expect(refresh).toHaveBeenCalled();
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts.map(([url]) => url)).toEqual(["/api/v1/auth/sign-out"]);
  });

  it("asks GET /api/v1/me exactly once when it mounts, to keep the session alive", async () => {
    const { rerender } = render(<AccountMenu account={account} />);
    rerender(<AccountMenu account={account} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me");
    expect(init?.method ?? "GET").toBe("GET");
  });
});
