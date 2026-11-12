import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// After signing in the whole page is loaded again, so the server renders with the new cookie.
const assign = vi.fn();

const { SignInForm } = await import("./sign-in-form");

const fetchMock = vi.fn<typeof fetch>();

function problem(status: number, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Problem",
      status,
      code: "unauthenticated",
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

async function submit(next = "/") {
  const user = userEvent.setup();
  render(<SignInForm next={next} />);
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "a long enough password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("SignInForm", () => {
  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts the email and password, then loads the return path", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "x" }, { status: 200 }));

    await submit("/projects/1");

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/projects/1");
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/auth/sign-in");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toEqual({
      email: "ada@example.com",
      password: "a long enough password",
    });
  });

  it("shows one generic message for a 401", async () => {
    fetchMock.mockResolvedValue(problem(401));

    await submit();

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("says how long to wait on a 429", async () => {
    fetchMock.mockResolvedValue(problem(429, { "Retry-After": "540" }));

    await submit();

    expect(
      await screen.findByText("Too many attempts. Try again in 9 minutes."),
    ).toBeInTheDocument();
  });

  it("shows a generic message for anything else", async () => {
    fetchMock.mockResolvedValue(problem(500));

    await submit();

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("disables the button while sending", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    await submit();

    expect(screen.getByRole("button", { name: /Signing in/ })).toBeDisabled();
  });

  it("tells the person to ask an administrator for a reset link", () => {
    render(<SignInForm next="/" />);

    expect(
      screen.getByText("Forgot your password? Ask an administrator for a reset link."),
    ).toBeInTheDocument();
  });
});
